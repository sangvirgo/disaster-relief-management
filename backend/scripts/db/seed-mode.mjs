export function seedMode(hasApplicationData) {
  return hasApplicationData ? 'campaigns' : 'full';
}
