#!/usr/bin/env tsx

/**
 * Utility script to create a test account
 * Usage: npx tsx scripts/create-user.ts <email> <password> <name> <phoneNumber>
 */

import bcrypt from 'bcrypt';
import { prisma } from '../src/lib/db.js';
import { connectDb, disconnectDb } from '../src/lib/db.js';

const BCRYPT_ROUNDS = 12;

async function createUser(email: string, password: string, name: string, phoneNumber: string) {
  await connectDb();

  try {
    // Check if an account already exists for this email
    const existingAccount = await prisma.account.findFirst({
      where: { person: { email } },
    });

    if (existingAccount) {
      console.error(`Account with email ${email} already exists`);
      process.exit(1);
    }

    const existingPerson = await prisma.person.findUnique({
      where: { phoneNumber },
      include: { account: true },
    });

    if (existingPerson?.account) {
      console.error(`Account already exists for phone number ${phoneNumber}`);
      process.exit(1);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create Person (or reuse an existing guest Person) + Account
    const account = existingPerson
      ? await prisma.$transaction(async (tx) => {
          await tx.person.update({
            where: { id: existingPerson.id },
            data: { fullName: name, email },
          });
          return tx.account.create({
            data: { personId: existingPerson.id, passwordHash: hashedPassword },
            include: { person: true },
          });
        })
      : await prisma.account.create({
          data: {
            passwordHash: hashedPassword,
            person: { create: { phoneNumber, fullName: name, email } },
          },
          include: { person: true },
        });

    console.log('Account created successfully:');
    console.log(
      JSON.stringify(
        {
          id: account.id,
          email: account.person.email,
          name: account.person.fullName,
          phoneNumber: account.person.phoneNumber,
          createdAt: account.createdAt,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error('Failed to create account:', error);
    process.exit(1);
  } finally {
    await disconnectDb();
  }
}

// Parse command line arguments
const [email, password, name, phoneNumber] = process.argv.slice(2);

if (!email || !password || !name || !phoneNumber) {
  console.error('Usage: npx tsx scripts/create-user.ts <email> <password> <name> <phoneNumber>');
  console.error(
    'Example: npx tsx scripts/create-user.ts test@example.com MyPassword123 "Test User" +221700000000'
  );
  process.exit(1);
}

createUser(email, password, name, phoneNumber);
