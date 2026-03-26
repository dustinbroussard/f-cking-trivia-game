export default async function handler(req: any, res: any) {
  res.setHeader('Allow', 'POST');

  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(410).json({
    error: 'The legacy maintenance top-up route has been retired.',
    nextStep: 'Manage question inventory directly in Supabase instead of through the application.',
  });
}
