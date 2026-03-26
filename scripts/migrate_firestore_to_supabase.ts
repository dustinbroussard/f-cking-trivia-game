/*
  Supabase Migration Utility
  ==========================
  This script extracts data from Firestore and transforms it for Supabase.

  Prerequisites:
  1. Set environment variables:
     - SUPABASE_URL
     - SUPABASE_SERVICE_ROLE_KEY
     - FIREBASE_SERVICE_ACCOUNT (JSON string or path to .json)
  2. Run with: npx tsx scripts/migrate_firestore_to_supabase.ts
*/

import 'dotenv/config';
import admin from 'firebase-admin';
import { createClient } from '@supabase/supabase-js';

// FIREBASE ADMIN INIT
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
  : require('../firebase-blueprint.json'); // Fallback to local blueprint if safe

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const firestore = admin.firestore();

// SUPABASE INIT
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateQuestions() {
  console.log('--- Migrating Questions Bank ---');
  const snapshot = await firestore.collection('questions').get();
  console.log(`Found ${snapshot.size} questions.`);

  const batchSize = 100;
  for (let i = 0; i < snapshot.size; i += batchSize) {
    const batch = snapshot.docs.slice(i, i + batchSize);
    const transformed = batch.map(doc => {
      const q = doc.data();
      return {
        id: doc.id,
        content: q.question,
        correct_answer: q.choices[q.correctIndex],
        distractors: q.choices.filter((_: any, idx: number) => idx !== q.correctIndex),
        category: q.category,
        difficulty_level: q.difficulty || 'medium',
        explanation: q.explanation,
        styling: {
          hostLeadIn: q.hostLeadIn,
          questionStyled: q.questionStyled,
          explanationStyled: q.explanationStyled
        },
        batch_id: q.batchId,
        metadata: q // Full heritage for safety
      };
    });

    const { error } = await supabase.from('questions').upsert(transformed);
    if (error) {
      console.error(`  Batch Error: ${error.message}`);
    } else {
      console.log(`  Processed ${i + transformed.length}/${snapshot.size} questions.`);
    }
  }
}

async function migrateProfiles() {
  console.log('\n--- Migrating User Profiles ---');
  const snapshot = await firestore.collection('users').get();
  console.log(`Found ${snapshot.size} users.`);

  const batchSize = 100;
  for (let i = 0; i < snapshot.size; i += batchSize) {
    const batch = snapshot.docs.slice(i, i + batchSize);
    const transformed = batch.map(doc => {
      const u = doc.data();
      return {
        id: doc.id,
        display_name: u.displayName || u.name,
        photo_url: u.photoURL || u.avatarUrl,
        stats: u.stats || {},
        updated_at: new Date().toISOString()
      };
    });

    const { error } = await supabase.from('profiles').upsert(transformed);
    if (error) {
      console.error(`  Batch Error: ${error.message}`);
    } else {
      console.log(`  Processed ${i + transformed.length}/${snapshot.size} users.`);
    }
  }
}

async function startMigration() {
  try {
    await migrateQuestions();
    await migrateProfiles();
    console.log('\n--- Migration Success! ---');
  } catch (err) {
    console.error('\n--- Migration Failed! ---', err);
  }
}

startMigration();
