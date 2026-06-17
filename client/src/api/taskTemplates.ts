import api from './index';
import type { TaskTemplate } from '../types';

export const getTaskTemplates = async (): Promise<TaskTemplate[]> => {
  const res = await api.get('/task-templates');
  return res.data;
};

export const getTaskTemplate = async (id: number): Promise<TaskTemplate> => {
  const res = await api.get(`/task-templates/${id}`);
  return res.data;
};

export const createTaskTemplate = async (data: {
  name: string;
  description?: string;
  items: Array<{
    task_name: string;
    hours: number;
    project_id?: number;
    description?: string;
  }>;
}): Promise<TaskTemplate> => {
  const res = await api.post('/task-templates', data);
  return res.data;
};

export const updateTaskTemplate = async (
  id: number,
  data: {
    name: string;
    description?: string;
    items: Array<{
      task_name: string;
      hours: number;
      project_id?: number;
      description?: string;
    }>;
  }
): Promise<TaskTemplate> => {
  const res = await api.put(`/task-templates/${id}`, data);
  return res.data;
};

export const deleteTaskTemplate = async (id: number): Promise<void> => {
  await api.delete(`/task-templates/${id}`);
};

export const applyTaskTemplate = async (id: number, entry_date: string): Promise<{
  entries: any[];
  totalHours: number;
  isOvertime: boolean;
}> => {
  const res = await api.post(`/task-templates/${id}/apply`, { entry_date });
  return res.data;
};
