import { Atom, Cpu, Landmark, Palette, Shuffle, Trophy, Tv, type LucideIcon } from 'lucide-react';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'History': Landmark,
  'Science': Atom,
  'Pop Culture': Tv,
  'Art & Music': Palette,
  'Sports': Trophy,
  'Technology': Cpu,
  'Random': Shuffle,
};

export function getCategoryIcon(category: string) {
  return CATEGORY_ICONS[category];
}
