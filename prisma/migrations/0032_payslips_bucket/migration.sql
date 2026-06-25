-- Create the private `payslips` bucket where a Storage schema exists (prod / Supabase).
-- No-op on plain Postgres test DBs (koolman_test) that have no storage schema.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('payslips', 'payslips', false)
    on conflict (id) do nothing;
  end if;
end $$;
