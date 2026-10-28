export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Não foi possível concluir a operação.');
  return data;
}
export const post = (path, data = {}) => api(path, { method: 'POST', body: JSON.stringify(data) });
export const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const date = value => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const go = path => { window.location.hash = path; window.scrollTo(0, 0); };
export const labels = { live: 'Ao vivo', scheduled: 'Agendado', closed: 'Encerrado', cancelled: 'Cancelado' };
