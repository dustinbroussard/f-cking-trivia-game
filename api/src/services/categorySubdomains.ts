export const CATEGORY_SUBDOMAINS = {
  History: [
    'U.S. History',
    'World History',
    'Ancient Civilizations',
    'Wars',
    'Historical Figures',
  ],
  Science: [
    'Biology',
    'Physics',
    'Chemistry',
    'Earth Science',
    'Astronomy',
  ],
  'Pop Culture': [
    'Film (modern)',
    'Television',
    'Celebrities',
    'Internet Culture',
    'Music (modern charts)',
  ],
  Sports: [
    'Professional leagues',
    'Olympics',
    'Records',
    'Teams',
    'Athletes',
  ],
  'Art & Music': [
    'Music history (American genres like blues, jazz, rock)',
    'Literature',
    'Visual art',
    'Film (classic or director-focused)',
    'Theater',
  ],
  Technology: [
    'Computers',
    'Internet history',
    'AI and software',
    'Consumer technology',
    'Tech companies',
  ],
} as const;

export function getGenerationCategoryProfile(category: string) {
  switch (category) {
    case 'History':
    case 'Science':
    case 'Pop Culture':
    case 'Sports':
    case 'Art & Music':
    case 'Technology':
      return {
        promptCategory: category,
        subdomains: CATEGORY_SUBDOMAINS[category as keyof typeof CATEGORY_SUBDOMAINS],
      };
    default:
      return {
        promptCategory: category,
        subdomains: [] as string[],
      };
  }
}
