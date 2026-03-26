import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { FLAGGED_QUESTIONS_COLLECTION } from './questionCollections';

interface FlagQuestionParams {
  questionId: string;
  userId?: string | null;
  gameId?: string | null;
}

export async function flagQuestion({ questionId, userId, gameId }: FlagQuestionParams) {
  await addDoc(collection(db, FLAGGED_QUESTIONS_COLLECTION), {
    questionId,
    ...(userId ? { userId } : {}),
    ...(gameId ? { gameId } : {}),
    flaggedAt: serverTimestamp(),
  });
}
