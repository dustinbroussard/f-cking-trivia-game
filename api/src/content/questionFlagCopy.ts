const QUESTION_FLAG_LINES = [
  "Hate this question? Tag it, and we'll hurt its feelings.",
  "This question sucks? Flag it and we'll take its lunch money.",
  "Think this one was busted? Flag it and we'll drag it into review.",
  "Was that question sketchy? Call it out. We'll make it explain itself.",
  "Question felt wrong, weird, or lazy? Flag it. We'll bully it professionally.",
];

export function getRandomQuestionFlagLine() {
  return QUESTION_FLAG_LINES[Math.floor(Math.random() * QUESTION_FLAG_LINES.length)];
}
