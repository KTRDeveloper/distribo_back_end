#!/usr/bin/env tsx

/**
 * Utility script to create a test user
 * Usage: npx tsx scripts/create-user.ts <email> <password> <name>
 */

import bcrypt from 'bcrypt';
import { prisma } from '../src/lib/db.js';
import { connectDb, disconnectDb } from '../src/lib/db.js';
import { UserStatus } from '@prisma/client';

const BCRYPT_ROUNDS = 12;

async function createUser(email: string, password: string, name: string) {
  await connectDb();

  try {
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.error(`User with email ${email} already exists`);
      process.exit(1);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        status: UserStatus.ACTIVE,
      },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        createdAt: true,
      },
    });

    console.log('User created successfully:');
    console.log(JSON.stringify(user, null, 2));
  } catch (error) {
    console.error('Failed to create user:', error);
    process.exit(1);
  } finally {
    await disconnectDb();
  }
}

// Parse command line arguments
const [email, password, name] = process.argv.slice(2);

if (!email || !password || !name) {
  console.error('Usage: npx tsx scripts/create-user.ts <email> <password> <name>');
  console.error('Example: npx tsx scripts/create-user.ts test@example.com MyPassword123 "Test User"');
  process.exit(1);
}

createUser(email, password, name);
