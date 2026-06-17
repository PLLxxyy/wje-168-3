import { Router } from 'express';
import db from '../database';
import { authenticateToken } from '../middleware/auth';
import { TaskTemplate, TaskTemplateItem, TimeEntry } from '../types';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未认证' });

  const templates = db.prepare(`
    SELECT * FROM task_templates 
    WHERE user_id = ? 
    ORDER BY updated_at DESC
  `).all(req.user.userId) as TaskTemplate[];

  const templateIds = templates.map(t => t.id);
  if (templateIds.length > 0) {
    const placeholders = templateIds.map(() => '?').join(',');
    const items = db.prepare(`
      SELECT * FROM task_template_items 
      WHERE template_id IN (${placeholders})
      ORDER BY template_id, sort_order, id
    `).all(...templateIds) as TaskTemplateItem[];

    const itemsByTemplate = new Map<number, TaskTemplateItem[]>();
    for (const item of items) {
      if (!itemsByTemplate.has(item.template_id)) {
        itemsByTemplate.set(item.template_id, []);
      }
      itemsByTemplate.get(item.template_id)!.push(item);
    }

    for (const template of templates) {
      template.items = itemsByTemplate.get(template.id) || [];
    }
  }

  res.json(templates);
});

router.get('/:id', authenticateToken, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未认证' });

  const { id } = req.params;
  const template = db.prepare(`
    SELECT * FROM task_templates WHERE id = ? AND user_id = ?
  `).get(id, req.user.userId) as TaskTemplate | undefined;

  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  const items = db.prepare(`
    SELECT * FROM task_template_items 
    WHERE template_id = ? 
    ORDER BY sort_order, id
  `).all(id) as TaskTemplateItem[];

  template.items = items;
  res.json(template);
});

router.post('/', authenticateToken, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未认证' });

  const { name, description, items } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '请输入模板名称' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '请至少添加一条任务' });
  }

  const insertTemplateStmt = db.prepare(`
    INSERT INTO task_templates (user_id, name, description)
    VALUES (?, ?, ?)
  `);

  const insertItemStmt = db.prepare(`
    INSERT INTO task_template_items (template_id, task_name, hours, project_id, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = insertTemplateStmt.run(req.user!.userId, name.trim(), description || null);
    const templateId = result.lastInsertRowid as number;

    items.forEach((item: any, index: number) => {
      insertItemStmt.run(
        templateId,
        item.task_name,
        Number(item.hours),
        item.project_id || null,
        item.description || null,
        index
      );
    });

    return templateId;
  });

  try {
    const templateId = transaction();

    const template = db.prepare(`
      SELECT * FROM task_templates WHERE id = ?
    `).get(templateId) as TaskTemplate;

    const templateItems = db.prepare(`
      SELECT * FROM task_template_items WHERE template_id = ? ORDER BY sort_order, id
    `).all(templateId) as TaskTemplateItem[];

    template.items = templateItems;
    res.json(template);
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: '创建失败，请重试' });
  }
});

router.put('/:id', authenticateToken, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未认证' });

  const { id } = req.params;
  const { name, description, items } = req.body;

  const existing = db.prepare(`
    SELECT * FROM task_templates WHERE id = ? AND user_id = ?
  `).get(id, req.user.userId) as TaskTemplate | undefined;

  if (!existing) {
    return res.status(404).json({ error: '模板不存在' });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '请输入模板名称' });
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '请至少添加一条任务' });
  }

  const updateTemplateStmt = db.prepare(`
    UPDATE task_templates 
    SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const deleteItemsStmt = db.prepare(`
    DELETE FROM task_template_items WHERE template_id = ?
  `);

  const insertItemStmt = db.prepare(`
    INSERT INTO task_template_items (template_id, task_name, hours, project_id, description, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    updateTemplateStmt.run(name.trim(), description || null, id);
    deleteItemsStmt.run(id);

    items.forEach((item: any, index: number) => {
      insertItemStmt.run(
        id,
        item.task_name,
        Number(item.hours),
        item.project_id || null,
        item.description || null,
        index
      );
    });
  });

  try {
    transaction();

    const template = db.prepare(`
      SELECT * FROM task_templates WHERE id = ?
    `).get(id) as TaskTemplate;

    const templateItems = db.prepare(`
      SELECT * FROM task_template_items WHERE template_id = ? ORDER BY sort_order, id
    `).all(id) as TaskTemplateItem[];

    template.items = templateItems;
    res.json(template);
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: '更新失败，请重试' });
  }
});

router.delete('/:id', authenticateToken, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未认证' });

  const { id } = req.params;
  const existing = db.prepare(`
    SELECT * FROM task_templates WHERE id = ? AND user_id = ?
  `).get(id, req.user.userId) as TaskTemplate | undefined;

  if (!existing) {
    return res.status(404).json({ error: '模板不存在' });
  }

  db.prepare('DELETE FROM task_templates WHERE id = ?').run(id);
  res.json({ success: true });
});

router.post('/:id/apply', authenticateToken, (req, res) => {
  if (!req.user) return res.status(401).json({ error: '未认证' });

  const { id } = req.params;
  const { entry_date } = req.body;

  if (!entry_date) {
    return res.status(400).json({ error: '请选择日期' });
  }

  const template = db.prepare(`
    SELECT * FROM task_templates WHERE id = ? AND user_id = ?
  `).get(id, req.user.userId) as TaskTemplate | undefined;

  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  const items = db.prepare(`
    SELECT * FROM task_template_items WHERE template_id = ? ORDER BY sort_order, id
  `).all(id) as TaskTemplateItem[];

  if (items.length === 0) {
    return res.status(400).json({ error: '模板为空' });
  }

  const totalHours = items.reduce((sum, item) => sum + item.hours, 0);
  const isOvertime = totalHours > 8 ? 1 : 0;

  const deleteStmt = db.prepare(`
    DELETE FROM time_entries 
    WHERE user_id = ? AND entry_date = ? AND status IN ('pending', 'rejected')
  `);

  const insertStmt = db.prepare(`
    INSERT INTO time_entries (user_id, entry_date, task_name, hours, project_id, description, is_overtime, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  const transaction = db.transaction(() => {
    deleteStmt.run(req.user!.userId, entry_date);

    const insertedIds: number[] = [];
    for (const item of items) {
      const result = insertStmt.run(
        req.user!.userId,
        entry_date,
        item.task_name,
        item.hours,
        item.project_id || null,
        item.description || null,
        isOvertime
      );
      insertedIds.push(result.lastInsertRowid as number);
    }

    return insertedIds;
  });

  try {
    const insertedIds = transaction();

    const savedEntries = db.prepare(`
      SELECT te.*, p.name as project_name
      FROM time_entries te
      LEFT JOIN projects p ON te.project_id = p.id
      WHERE te.id IN (${insertedIds.map(() => '?').join(',')})
    `).all(...insertedIds) as TimeEntry[];

    res.json({ entries: savedEntries, totalHours, isOvertime });
  } catch (error) {
    console.error('Apply template error:', error);
    res.status(500).json({ error: '套用失败，请重试' });
  }
});

export default router;
