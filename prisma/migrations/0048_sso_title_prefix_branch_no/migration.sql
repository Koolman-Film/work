-- สปส.1-10's official upload template needs two things we never stored.
--
-- `คำนำหน้าชื่อ` is column B of the template and is mandatory. It is an enum
-- rather than free text because this value lands in a statutory file: a typo
-- in "นางสาว" is not something the portal will forgive, and ภ.ง.ด.1 later
-- wants the SAME concept as a 3-digit code, which only a closed set can map
-- to. Rare titles (ว่าที่ร้อยตรี, ดร.) are deliberately out of scope — SSO's
-- own code list is finite and these three cover payroll.
CREATE TYPE "TitlePrefix" AS ENUM ('Mr', 'Mrs', 'Miss');

ALTER TABLE "Employee" ADD COLUMN "titlePrefix" "TitlePrefix";

-- The SSO-assigned branch SEQUENCE number, e.g. "000000" for a head office.
-- Distinct from `ssoAccountNo`, which is the employer account (เลขที่บัญชี
-- นายจ้าง). The template requires the worksheet to be NAMED for this value:
-- "โปรดระบุชื่อ Sheet ให้ตรงกับลำดับที่สาขาที่สำนักงานประกันสังคมกำหนด".
ALTER TABLE "Branch" ADD COLUMN "ssoBranchNo" TEXT;
