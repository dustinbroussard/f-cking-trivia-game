interface FlagQuestionParams {
  questionId: string;
  userId?: string | null;
  gameId?: string | null;
}

export async function flagQuestion({ questionId, userId, gameId }: FlagQuestionParams) {
  console.info('[questionFlag] Review queue is temporarily disabled during the Firebase -> Supabase migration.', {
    questionId,
    userId,
    gameId,
  });
}
