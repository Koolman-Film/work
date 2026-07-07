-- SSO สปส.1-10 filing identity fields (all optional → null = not yet entered)
ALTER TABLE "Employee" ADD COLUMN "nationalId" TEXT;
ALTER TABLE "Branch" ADD COLUMN "ssoAccountNo" TEXT;
