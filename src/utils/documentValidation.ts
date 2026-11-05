// Valida título (1-120) y enlace https (máx. 2000) de un documento del residencial
export const validateDocumentInput = (title: unknown, url: unknown): { title: string; url: string } | string => {
  const t = typeof title === 'string' ? title.trim() : '';
  const u = typeof url === 'string' ? url.trim() : '';
  if (t.length < 1 || t.length > 120) return 'El título debe tener entre 1 y 120 caracteres';
  if (u.length > 2000 || !/^https:\/\/[^\s]+$/i.test(u)) return 'El enlace debe iniciar con https:// (máx. 2000 caracteres)';
  return { title: t, url: u };
};
