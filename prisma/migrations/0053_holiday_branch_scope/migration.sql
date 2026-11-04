-- Branch-scoped holidays: a holiday can apply to listed branches only (by the
-- employee's home branch). Empty = every branch, so every existing row keeps
-- meaning exactly what it meant before. Additive; no data rewrite.
ALTER TABLE "Holiday" ADD COLUMN "branchIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
