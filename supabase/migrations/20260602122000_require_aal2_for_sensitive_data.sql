-- Require a second authentication factor for sensitive BankDash data.
-- Profiles stay accessible with the existing ownership policy so users can
-- reach account/security setup before financial data is unlocked.

create or replace function public.bankdash_has_aal2()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

drop policy if exists "Users manage own accounts" on public.accounts;
create policy "Users manage own accounts"
on public.accounts for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own statement uploads" on public.statement_uploads;
create policy "Users manage own statement uploads"
on public.statement_uploads for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users read default and own categories" on public.categories;
create policy "Users read default and own categories"
on public.categories for select
using (
  user_id is null
  or (auth.uid() = user_id and public.bankdash_has_aal2())
);

drop policy if exists "Users insert own categories" on public.categories;
create policy "Users insert own categories"
on public.categories for insert
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users update own categories" on public.categories;
create policy "Users update own categories"
on public.categories for update
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users delete own categories" on public.categories;
create policy "Users delete own categories"
on public.categories for delete
using (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own transactions" on public.transactions;
create policy "Users manage own transactions"
on public.transactions for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own category rules" on public.category_rules;
create policy "Users manage own category rules"
on public.category_rules for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own recurring payments" on public.recurring_payments;
create policy "Users manage own recurring payments"
on public.recurring_payments for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own Google allowlist" on public.google_allowed_payments;
create policy "Users manage own Google allowlist"
on public.google_allowed_payments for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own budgets" on public.monthly_budgets;
create policy "Users manage own budgets"
on public.monthly_budgets for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own savings goals" on public.savings_goals;
create policy "Users manage own savings goals"
on public.savings_goals for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own manual expenses" on public.manual_expenses;
create policy "Users manage own manual expenses"
on public.manual_expenses for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users manage own synced app state" on public.user_app_state;
create policy "Users manage own synced app state"
on public.user_app_state for all
using (auth.uid() = user_id and public.bankdash_has_aal2())
with check (auth.uid() = user_id and public.bankdash_has_aal2());

drop policy if exists "Users read own bank statement files" on storage.objects;
create policy "Users read own bank statement files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'bank-statements'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.bankdash_has_aal2()
);

drop policy if exists "Users upload own bank statement files" on storage.objects;
create policy "Users upload own bank statement files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'bank-statements'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.bankdash_has_aal2()
);

drop policy if exists "Users update own bank statement files" on storage.objects;
create policy "Users update own bank statement files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'bank-statements'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.bankdash_has_aal2()
)
with check (
  bucket_id = 'bank-statements'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.bankdash_has_aal2()
);

drop policy if exists "Users delete own bank statement files" on storage.objects;
create policy "Users delete own bank statement files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'bank-statements'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.bankdash_has_aal2()
);
