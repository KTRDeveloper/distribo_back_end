-- AlterEnum
-- Login no longer uses OTP (phone number + password instead); OTP is now
-- used at registration (to verify the phone number) and for password reset.
ALTER TYPE "OtpPurpose" RENAME VALUE 'SIGN_IN' TO 'REGISTRATION';
