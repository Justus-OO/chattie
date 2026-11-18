export const normalizeMediaType = (mediaType) => {
  const value = typeof mediaType === 'string' ? mediaType.toLowerCase() : '';

  if (value === 'video' || value.startsWith('video/')) return 'video';
  if (value === 'image' || value.startsWith('image/')) return 'image';
  return value || 'image';
};
