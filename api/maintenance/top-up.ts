export default async function handler(req: any, res: any) {
  res.setHeader('Allow', 'POST');

  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(410).json({
    error: 'The Firebase maintenance top-up route has been retired during the Supabase migration.',
    nextStep: 'Replace this endpoint with a Supabase-backed admin or Edge Function before re-enabling generator tooling.',
  });
}
