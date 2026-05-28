(function () {
    const config = window.BANKDASH_SUPABASE;
    const sourceData = window.BANKDASH_DATA || { transactions: [], salaryTransactions: [], savingsTransfers: [] };
    const supabaseFactory = window.supabase;
    const currency = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
    const maxStatementFiles = 3;

    if (!config || !supabaseFactory) {
        const status = document.getElementById('supabaseStatus');
        const authStatus = document.getElementById('authStatus');
        if (status) status.textContent = 'Supabase client unavailable. Check internet access and script loading.';
        if (authStatus) authStatus.textContent = 'Supabase client unavailable.';
        return;
    }

    const client = supabaseFactory.createClient(config.url, config.publishableKey);
    let currentUser = null;
    let cachedTransactions = [];
    let selectedPriorityMatch = null;
    let primaryAccountId = null;
    let pendingImportData = null;
    let isPasswordRecovery = false;

    window.BankDashAuth = {
        currentEmail: () => currentUser?.email || '',
        verifyPassword: async (password) => {
            if (!currentUser?.email) return { ok: false, message: 'Sign in before unlocking card details.' };
            const { error } = await client.auth.signInWithPassword({ email: currentUser.email, password });
            if (error) return { ok: false, message: error.message || 'Password check failed.' };
            return { ok: true };
        },
    };

    const originalManualBaseline = {
        expenses: 0,
        salaries: 0,
        savingsTransfers: 0,
        totalRecords: 0,
        income: 0,
        expensesTotal: 0,
        savingsIn: 0,
        savingsOut: 0,
    };

    const byId = (id) => document.getElementById(id);
    const setText = (id, value) => {
        const node = byId(id);
        if (node) node.textContent = value;
    };
    const setValue = (id, value) => {
        const node = byId(id);
        if (node) node.value = value ?? '';
    };
    const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
    const parseMoneyInput = (id) => roundMoney(Number(byId(id)?.value || 0));
    const escapeHtml = (value) =>
        String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');

    function sourceHash(value) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `bd_${(hash >>> 0).toString(16)}`;
    }

    function categoryGroup(item) {
        if (item.category === 'Bank fees') return 'fees';
        if (item.category === 'GoalSave') return 'savings';
        if (item.priority === 'priority') return 'priority';
        return 'non_priority';
    }

    function isEssential(item) {
        return /internet|fibre|fiber|vehicle finance|car finance|auto finance|loan|credit provider|finance provider|gym|fitness|rent|landlord/i
            .test(`${item.description} ${item.merchant_name || item.merchant || ''}`);
    }

    function inferCategory(description) {
        const value = description.toLowerCase();
        if (/(^|\s)fee[:\s]|transactional sms|monthly service/i.test(value)) return 'Bank fees';
        if (/goalsave/i.test(value)) return 'GoalSave';
        if (/eft for perfect circle salar|salary|salar/i.test(value)) return 'Salary';
        if (/vas - mobile purchase|data bundle|\bdata\b/i.test(value)) return 'Mobile/data';
        if (/debit order|debicheck/i.test(value)) return 'Debit orders';
        if (/internet|fibre|fiber|vehicle finance|car finance|auto finance|rent|landlord|loan|credit provider|finance provider/i.test(value)) return 'Fixed beneficiaries/EFT';
        if (/seattle|coffee|restaurant|bakery|bistro|kfc|mcdonald|steers|food|cafe/i.test(value)) return 'Dining & coffee';
        if (/checkers|woolworths|pick n pay|spar|grocery|grocer/i.test(value)) return 'Groceries';
        if (/fuel|engen|shell|bp |caltex|sasol|total/i.test(value)) return 'Fuel/transport';
        if (/google|youtube|openai|chatgpt|strava|netflix|spotify|subscription|patreon|discord/i.test(value)) return 'Subscriptions/software';
        if (/takealot|amazon|shop|online|purchase at/i.test(value)) return 'Shopping & online';
        if (/fitness|gym/i.test(value)) return 'Healthcare';
        if (/rent|landlord|loan|internet|fibre|fiber|vehicle finance|car finance|auto finance/i.test(value)) return 'Fixed beneficiaries/EFT';
        return 'Other';
    }

    function inferMerchant(description) {
        return description
            .replace(/^purchase at\s+/i, '')
            .replace(/^fee:\s*/i, '')
            .replace(/\s+ZA\s+\d+$/i, '')
            .replace(/\s+\d{8,}$/g, '')
            .trim()
            .slice(0, 80) || 'Unknown';
    }

    function priorityForDescription(description, category) {
        if (['Dining & coffee', 'Leisure', 'Other', 'Shopping & online', 'Subscriptions/software'].includes(category)) return 'non-priority';
        if (/google|youtube|strava/i.test(description)) return 'non-priority';
        return 'priority';
    }

    function isUnexpectedGooglePayment(description, amount) {
        if (!/google|youtube|strava/i.test(description)) return false;
        return ![34.99, 81.99, 89.99].includes(roundMoney(amount));
    }

    function buildImportRows(userId, accountId, categoryMap, importData = sourceData, uploadId = null) {
        const expenseRows = importData.transactions.map((item) => ({
            user_id: userId,
            account_id: accountId,
            statement_upload_id: item.statementUploadId || uploadId,
            category_id: categoryMap.get(item.category) || null,
            transaction_date: item.date,
            posted_date: item.date,
            description: item.description,
            merchant_name: item.merchant,
            amount: roundMoney(item.amount),
            direction: 'expense',
            is_priority: item.priority === 'priority',
            is_essential: isEssential(item),
            is_recurring: isEssential(item) || /Google|OPENAI|Netflix|Spotify|Strava|YouTube/i.test(`${item.description} ${item.merchant}`),
            is_flagged: isUnexpectedGooglePayment(`${item.description} ${item.merchant}`, item.amount),
            flag_reason: isUnexpectedGooglePayment(`${item.description} ${item.merchant}`, item.amount)
                ? 'Unexpected Google payment'
                : null,
            source_hash: sourceHash(`expense|${item.sourceFile}|${item.date}|${item.description}|${item.amount}|${item.balance}`),
        }));

        const salaryRows = importData.salaryTransactions.map((item) => ({
            user_id: userId,
            account_id: accountId,
            statement_upload_id: item.statementUploadId || uploadId,
            category_id: categoryMap.get('Salary') || null,
            transaction_date: item.date,
            posted_date: item.date,
            description: item.description,
            merchant_name: 'Perfect Circle Salary',
            amount: roundMoney(item.moneyIn),
            direction: 'income',
            is_priority: false,
            is_essential: false,
            is_recurring: true,
            is_flagged: false,
            flag_reason: null,
            source_hash: sourceHash(`salary|${item.sourceFile}|${item.date}|${item.description}|${item.moneyIn}|${item.balance}`),
        }));

        const savingsRows = importData.savingsTransfers.map((item) => {
            const direction = item.direction === 'From savings' ? 'income' : 'expense';
            const amount = direction === 'income' ? item.moneyIn : roundMoney(item.moneyOut + item.fees);
            return {
                user_id: userId,
                account_id: accountId,
                statement_upload_id: item.statementUploadId || uploadId,
                category_id: categoryMap.get('GoalSave') || null,
                transaction_date: item.date,
                posted_date: item.date,
                description: item.description,
                merchant_name: 'GoalSave',
                amount: roundMoney(amount),
                direction,
                is_priority: true,
                is_essential: false,
                is_recurring: false,
                is_flagged: false,
                flag_reason: null,
                source_hash: sourceHash(`goalsave|${item.sourceFile}|${item.date}|${item.description}|${amount}|${item.balance}`),
            };
        });

        return [...expenseRows, ...salaryRows, ...savingsRows];
    }

    function chunk(items, size) {
        const chunks = [];
        for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
        return chunks;
    }

    function safeFileName(name) {
        return name.replace(/[^a-z0-9_.-]/gi, '-').replace(/-+/g, '-');
    }

    function inferStatementDate(fileName) {
        const match = fileName.match(/(20\d{2})[_-](\d{2})/);
        if (!match) return { year: null, month: null };
        return { year: Number(match[1]), month: Number(match[2]) };
    }

    function firstNameFor(user) {
        const metadataName = user?.user_metadata?.first_name || user?.user_metadata?.full_name || user?.user_metadata?.name || '';
        const baseName = metadataName || user?.email?.split('@')[0] || 'User';
        const firstName = baseName.split(/[\s._-]+/).filter(Boolean)[0] || 'User';
        return firstName.charAt(0).toUpperCase() + firstName.slice(1);
    }

    function goToAccount() {
        if (window.BankDashRouter) {
            window.BankDashRouter.switchView('accountSettings');
            return;
        }
        window.location.hash = 'accountSettings';
        document.dispatchEvent(new CustomEvent('bankdash:navigate', { detail: { view: 'accountSettings' } }));
    }

    function bindButtonActivation(selector, handler) {
        const button = document.querySelector(selector);
        if (!button) return;
        button.addEventListener('click', (event) => handler(event));
        button.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handler(event);
        });
    }

    function showToast(type, title, message) {
        const stack = byId('toastStack');
        if (!stack) return;

        const toast = document.createElement('div');
        const tone = ['success', 'warning', 'error', 'info', 'basic'].includes(type) ? type : 'basic';
        toast.className = `bankdash-toast ${tone}`;
        toast.innerHTML = `
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(message || '')}</span>
        `;
        stack.appendChild(toast);
        window.setTimeout(() => toast.remove(), tone === 'error' ? 6500 : 4200);
    }

    function initialsFor(firstName, lastName, email) {
        const first = firstName || email?.charAt(0) || 'U';
        const last = lastName || '';
        return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
    }

    async function ensureProfile(user) {
        const { data: existing, error: fetchError } = await client
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();
        if (fetchError) throw fetchError;
        if (existing) return;

        const firstName = firstNameFor(user);
        const { error } = await client.from('profiles').insert({
            id: user.id,
            first_name: firstName,
            display_name: firstName,
            currency_code: 'ZAR',
            financial_cycle_start_day: 25,
            coffee_budget_cap: 0,
            default_goalsave_target: 1500,
            monthly_income_target: 0,
            timezone: 'Africa/Johannesburg',
        });
        if (error) throw error;
    }

    async function ensureAccount(userId) {
        const { data: existing, error: selectError } = await client
            .from('accounts')
            .select('id')
            .eq('user_id', userId)
            .eq('name', 'EveryDay account')
            .maybeSingle();
        if (selectError) throw selectError;
        if (existing) return existing.id;

        const { data, error } = await client
            .from('accounts')
            .insert({
                user_id: userId,
                name: 'EveryDay account',
                account_type: 'bank',
                institution: 'Bank',
                is_primary: true,
            })
            .select('id')
            .single();
        if (error) throw error;
        return data.id;
    }

    async function ensureCategories(userId, importData = sourceData) {
        const categories = Array.from(new Set([
            'Salary',
            'GoalSave',
            ...importData.transactions.map((item) => item.category),
        ])).map((name) => {
            const sample = importData.transactions.find((item) => item.category === name) || {};
            return {
                user_id: userId,
                name,
                category_group: name === 'Salary' ? 'income' : name === 'GoalSave' ? 'savings' : categoryGroup(sample),
                is_essential: ['Internet provider', 'Vehicle finance', 'Loan provider', 'Gym', 'Rent'].includes(name),
            };
        });

        const { error } = await client.from('categories').upsert(categories, { onConflict: 'user_id,name' });
        if (error) throw error;

        const { data, error: fetchError } = await client
            .from('categories')
            .select('id,name')
            .eq('user_id', userId);
        if (fetchError) throw fetchError;

        return new Map(data.map((item) => [item.name, item.id]));
    }

    async function seedKnownPayments(userId) {
        const googleRows = [
            { user_id: userId, name: 'Google One', expected_amount: 34.99, merchant_match: 'Google One' },
            { user_id: userId, name: 'YouTube Premium', expected_amount: 81.99, merchant_match: 'YouTubePremium|YouTube Premium' },
            { user_id: userId, name: 'Strava via Google', expected_amount: 89.99, merchant_match: 'Strava' },
        ];
        const { error: googleError } = await client.from('google_allowed_payments').upsert(googleRows, { onConflict: 'user_id,name' });
        if (googleError) throw googleError;
    }

    async function refreshDbStats() {
        if (!currentUser) {
            setText('supabaseDbStats', 'Not signed in');
            return;
        }

        const { count: transactionsCount } = await client
            .from('transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', currentUser.id);
        const { count: budgetCount } = await client
            .from('monthly_budgets')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', currentUser.id);

        setText('supabaseDbStats', `${transactionsCount || 0} transactions, ${budgetCount || 0} budgets in Supabase`);
    }

    function emptyDashboardData() {
        return {
            generatedAt: new Date().toISOString(),
            period: 'No imported statements',
            totals: {},
            monthly: [],
            salaryTransactions: [],
            savingsTransfers: [],
            transactions: [],
        };
    }

    function rowCategory(row) {
        return row.categories?.name || inferCategory(row.description || row.merchant_name || '');
    }

    function dashboardDataFromRows(rows) {
        const data = emptyDashboardData();
        rows.forEach((row) => {
            const category = rowCategory(row);
            if (row.direction === 'income' && category === 'Salary') {
                data.salaryTransactions.push({
                    sourceFile: row.statement_uploads?.file_name || 'Supabase',
                    statementPeriod: '',
                    account: row.accounts?.name || 'EveryDay account',
                    date: row.transaction_date,
                    description: row.description,
                    fees: 0,
                    moneyOut: 0,
                    moneyIn: Number(row.amount || 0),
                    balance: 0,
                });
                return;
            }

            if (category === 'GoalSave' || /goalsave/i.test(row.description || row.merchant_name || '')) {
                data.savingsTransfers.push({
                    sourceFile: row.statement_uploads?.file_name || 'Supabase',
                    statementPeriod: '',
                    account: row.accounts?.name || 'EveryDay account',
                    date: row.transaction_date,
                    description: row.description,
                    fees: 0,
                    moneyOut: row.direction === 'expense' ? Number(row.amount || 0) : 0,
                    moneyIn: row.direction === 'income' ? Number(row.amount || 0) : 0,
                    balance: 0,
                    direction: row.direction === 'income' ? 'From savings' : 'To savings',
                });
                return;
            }

            if (row.direction === 'expense') {
                data.transactions.push({
                    sourceFile: row.statement_uploads?.file_name || 'Supabase',
                    statementPeriod: '',
                    account: row.accounts?.name || 'EveryDay account',
                    date: row.transaction_date,
                    description: row.description,
                    fees: category === 'Bank fees' ? Number(row.amount || 0) : 0,
                    moneyOut: Number(row.amount || 0),
                    moneyIn: 0,
                    balance: 0,
                    amount: Number(row.amount || 0),
                    category,
                    priority: row.is_priority ? 'priority' : 'non-priority',
                    merchant: row.merchant_name || inferMerchant(row.description),
                });
            }
        });
        return data;
    }

    function sumBy(items, selector) {
        return roundMoney(items.reduce((sum, item) => sum + Number(selector(item) || 0), 0));
    }

    function renderImportCheck(data) {
        const expenses = data.transactions.length;
        const salaries = data.salaryTransactions.length;
        const savingsTransfers = data.savingsTransfers.length;
        const totalRecords = expenses + salaries + savingsTransfers;
        const income = sumBy(data.salaryTransactions, (item) => item.moneyIn);
        const expenseTotal = sumBy(data.transactions, (item) => item.amount);
        const savingsIn = sumBy(data.savingsTransfers.filter((item) => item.direction === 'To savings'), (item) => item.moneyOut + item.fees);
        const savingsOut = sumBy(data.savingsTransfers.filter((item) => item.direction === 'From savings'), (item) => item.moneyIn);
        const matchesBaseline = expenses === originalManualBaseline.expenses
            && salaries === originalManualBaseline.salaries
            && savingsTransfers === originalManualBaseline.savingsTransfers
            && totalRecords === originalManualBaseline.totalRecords;

        setText('importCheckStatus', matchesBaseline ? 'Matches original manual import' : 'Does not match original manual import');
        const detailRows = [
            ['Expense rows', expenses, originalManualBaseline.expenses],
            ['Salary rows', salaries, originalManualBaseline.salaries],
            ['GoalSave rows', savingsTransfers, originalManualBaseline.savingsTransfers],
            ['Total records', totalRecords, originalManualBaseline.totalRecords],
            ['Salary total', currency.format(income), currency.format(originalManualBaseline.income)],
            ['Expense total', currency.format(expenseTotal), currency.format(originalManualBaseline.expensesTotal)],
            ['GoalSave in', currency.format(savingsIn), currency.format(originalManualBaseline.savingsIn)],
            ['GoalSave out', currency.format(savingsOut), currency.format(originalManualBaseline.savingsOut)],
        ];

        const target = byId('importCheckDetails');
        if (!target) return;
        target.innerHTML = detailRows.map(([label, current, expected]) => {
            const good = String(current) === String(expected);
            return `
                <div class="feature-row ${good ? 'good' : 'warn'}">
                    <span>${escapeHtml(label)}<small>Expected ${escapeHtml(expected)}</small></span>
                    <strong>${escapeHtml(current)}</strong>
                </div>
            `;
        }).join('');
    }

    async function loadDashboardFromSupabase() {
        if (!currentUser) {
            window.BankDashData?.setData(emptyDashboardData());
            return;
        }

        const { data, error } = await client
            .from('transactions')
            .select('*, categories(name), accounts(name), statement_uploads(file_name)')
            .eq('user_id', currentUser.id)
            .order('transaction_date', { ascending: true })
            .limit(6000);

        if (error) {
            showToast('error', 'Dashboard load failed', error.message);
            window.BankDashData?.setData(emptyDashboardData());
            return;
        }

        const dashboardData = dashboardDataFromRows(data || []);
        window.BankDashData?.setData(dashboardData);
        renderImportCheck(dashboardData);
    }

    async function loadAccountSettings(quiet = false) {
        if (!currentUser) return;

        try {
            await ensureProfile(currentUser);
            const [{ data: profile, error: profileError }, { data: accounts, error: accountError }] = await Promise.all([
                client
                    .from('profiles')
                    .select('first_name,last_name,display_name,phone,currency_code,timezone,financial_cycle_start_day,monthly_income_target,default_goalsave_target,coffee_budget_cap,statement_password_hint')
                    .eq('id', currentUser.id)
                    .single(),
                client
                    .from('accounts')
                    .select('id,name,institution,account_mask,is_primary')
                    .eq('user_id', currentUser.id)
                    .order('is_primary', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(1),
            ]);
            if (profileError) throw profileError;
            if (accountError) throw accountError;

            const account = accounts?.[0] || null;
            primaryAccountId = account?.id || null;
            const firstName = profile.first_name || firstNameFor(currentUser);
            const lastName = profile.last_name || '';
            const displayName = profile.display_name || [firstName, lastName].filter(Boolean).join(' ') || firstName;

            setValue('accountFirstName', firstName);
            setValue('accountLastName', lastName);
            setValue('accountDisplayNameInput', displayName);
            setValue('accountPhone', profile.phone || '');
            setValue('accountCurrency', profile.currency_code || 'ZAR');
            setValue('accountTimezone', profile.timezone || 'Africa/Johannesburg');
            setValue('accountCycleDay', profile.financial_cycle_start_day || 25);
            setValue('accountIncomeTarget', profile.monthly_income_target || 0);
            setValue('accountGoalSaveTarget', profile.default_goalsave_target || 1500);
            setValue('accountCoffeeCap', profile.coffee_budget_cap || 0);
            setValue('accountPasswordHint', profile.statement_password_hint || '');
            setValue('accountBankName', account?.name || 'EveryDay account');
            setValue('accountInstitution', account?.institution || 'Bank');
            setValue('accountMask', account?.account_mask || '');

            setText('accountDisplayName', displayName);
            setText('accountEmail', currentUser.email);
            setText('accountInitials', initialsFor(firstName, lastName, currentUser.email));
            setText('userFirstName', firstName);

            if (!quiet) showToast('basic', 'Account loaded', 'Your saved account settings are shown.');
        } catch (error) {
            showToast('error', 'Account load failed', error.message || 'Could not load your account settings.');
        }
    }

    async function saveAccountSettings(event) {
        event.preventDefault();
        if (!currentUser) return;

        const firstName = byId('accountFirstName').value.trim() || firstNameFor(currentUser);
        const lastName = byId('accountLastName').value.trim();
        const displayName = byId('accountDisplayNameInput').value.trim() || [firstName, lastName].filter(Boolean).join(' ');
        const cycleDay = Number(byId('accountCycleDay').value || 25);
        if (cycleDay < 1 || cycleDay > 28) {
            showToast('warning', 'Check cycle day', 'Use a day between 1 and 28 so every month is valid.');
            return;
        }

        try {
            const profilePayload = {
                id: currentUser.id,
                first_name: firstName,
                last_name: lastName || null,
                display_name: displayName,
                phone: byId('accountPhone').value.trim() || null,
                currency_code: byId('accountCurrency').value || 'ZAR',
                timezone: byId('accountTimezone').value || 'Africa/Johannesburg',
                financial_cycle_start_day: cycleDay,
                monthly_income_target: parseMoneyInput('accountIncomeTarget'),
                default_goalsave_target: parseMoneyInput('accountGoalSaveTarget'),
                coffee_budget_cap: parseMoneyInput('accountCoffeeCap'),
                statement_password_hint: byId('accountPasswordHint').value.trim() || null,
            };

            const { error: profileError } = await client.from('profiles').upsert(profilePayload);
            if (profileError) throw profileError;

            const accountPayload = {
                user_id: currentUser.id,
                name: byId('accountBankName').value.trim() || 'EveryDay account',
                institution: byId('accountInstitution').value.trim() || 'Bank',
                account_mask: byId('accountMask').value.trim() || null,
                account_type: 'bank',
                is_primary: true,
            };

            if (primaryAccountId) {
                const { error: accountError } = await client
                    .from('accounts')
                    .update(accountPayload)
                    .eq('id', primaryAccountId)
                    .eq('user_id', currentUser.id);
                if (accountError) throw accountError;
            } else {
                const { data, error: accountError } = await client
                    .from('accounts')
                    .insert(accountPayload)
                    .select('id')
                    .single();
                if (accountError) throw accountError;
                primaryAccountId = data.id;
            }

            await client.auth.updateUser({ data: { first_name: firstName, full_name: displayName } });
            setText('accountDisplayName', displayName);
            setText('accountEmail', currentUser.email);
            setText('accountInitials', initialsFor(firstName, lastName, currentUser.email));
            setText('userFirstName', firstName);
            showToast('success', 'Account saved', 'Your profile and dashboard preferences were updated.');
        } catch (error) {
            showToast('error', 'Account save failed', error.message || 'Could not save account settings.');
        }
    }


    async function refreshUploadHistory() {
        if (!currentUser) {
            setText('uploadHistory', 'Sign in required');
            showToast('warning', 'Sign in required', 'Please sign in before loading uploads.');
            return;
        }

        const { data, error } = await client
            .from('statement_uploads')
            .select('file_name,status,created_at')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(6);

        const target = byId('uploadHistory');
        if (!target) return;
        if (error) {
            target.textContent = error.message;
            showToast('error', 'Upload history failed', error.message);
            return;
        }
        target.innerHTML = data.length
            ? data.map((item) => `
                <div class="feature-row">
                    <span>${escapeHtml(item.file_name)}</span>
                    <strong>${escapeHtml(item.status)}</strong>
                </div>
            `).join('')
            : 'No uploads yet';
    }

    async function refreshRuleData() {
        if (!currentUser) return;

        const [transactionsResult, rulesResult] = await Promise.all([
            client
                .from('transactions')
                .select('id,transaction_date,description,merchant_name,amount,direction,is_priority')
                .eq('user_id', currentUser.id)
                .eq('direction', 'expense')
                .order('transaction_date', { ascending: false })
                .limit(2000),
            client
                .from('recurring_payments')
                .select('name,merchant_match,expected_amount,payment_group,is_active')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false }),
        ]);

        if (!transactionsResult.error) cachedTransactions = transactionsResult.data || [];
        renderPrioritySuggestions();
        renderSavedPriorityRules(rulesResult.error ? [] : rulesResult.data || []);
    }

    function priorityTerms(value) {
        const base = value.toLowerCase().split(/\s+/).filter(Boolean);
        const synonyms = {
            car: ['car', 'vehicle', 'finance', 'installment'],
            vehicle: ['car', 'vehicle', 'finance', 'installment'],
            internet: ['internet', 'wifi', 'fibre'],
            rent: ['rent', 'landlord'],
            gym: ['gym', 'edge', 'fitness'],
            google: ['google', 'youtube', 'strava'],
        };
        return Array.from(new Set(base.flatMap((term) => synonyms[term] || [term])));
    }

    function renderPrioritySuggestions() {
        const target = byId('prioritySuggestions');
        if (!target) return;

        const name = byId('priorityRuleName')?.value.trim() || '';
        const terms = priorityTerms(name);
        if (!terms.length) {
            target.innerHTML = '<div class="feature-row"><span>Start typing a priority name</span><strong>Ready</strong></div>';
            return;
        }

        const suggestions = cachedTransactions
            .map((item) => {
                const haystack = `${item.merchant_name || ''} ${item.description || ''}`.toLowerCase();
                const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
                return { ...item, score };
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || b.amount - a.amount)
            .slice(0, 8);

        target.innerHTML = suggestions.length
            ? suggestions.map((item) => {
                const match = item.merchant_name || item.description;
                return `
                    <button type="button" class="suggestion-row ${selectedPriorityMatch === match ? 'selected' : ''}" data-priority-match="${escapeHtml(match)}">
                        <span>${escapeHtml(match)}</span>
                        <strong>${currency.format(item.amount || 0)}</strong>
                    </button>
                `;
            }).join('')
            : '<div class="feature-row"><span>No automatic matches</span><strong>Manual match still allowed</strong></div>';

        target.querySelectorAll('[data-priority-match]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedPriorityMatch = button.dataset.priorityMatch;
                renderPrioritySuggestions();
                setText('priorityRuleStatus', `Selected ${selectedPriorityMatch}`);
            });
        });
    }

    function renderSavedPriorityRules(rules) {
        const target = byId('savedPriorityRules');
        if (!target) return;
        target.innerHTML = rules.length
            ? rules.map((rule) => `
                <div class="feature-row">
                    <span>${escapeHtml(rule.name)}<small>${escapeHtml(rule.merchant_match)}</small></span>
                    <strong>${rule.expected_amount ? currency.format(rule.expected_amount) : 'Any amount'}</strong>
                </div>
            `).join('')
            : '<div class="feature-row"><span>No saved rules yet</span><strong>0</strong></div>';
    }

    function monthNumber(label) {
        return {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        }[label.toLowerCase().slice(0, 3)] || '01';
    }

    function isoFromStatementDate(value) {
        const match = value.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
        if (!match) return '';
        return `${match[3]}-${monthNumber(match[2])}-${String(match[1]).padStart(2, '0')}`;
    }

    function numberFromPdf(value) {
        if (!value || value === '-') return 0;
        return Number(String(value).replace(/[,\s]/g, '')) || 0;
    }

    function parseStatementLine(line, sourceFile, uploadId) {
        const dateMatch = line.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})/);
        if (!dateMatch) return null;

        const afterDate = line.slice(dateMatch.index + dateMatch[0].length).trim();
        const moneyMatches = [...afterDate.matchAll(/(?:^|\s)(-|\d{1,3}(?:[,\s]\d{3})*\.\d{2}|\d+\.\d{2}|0)(?=\s|$)/g)];
        if (moneyMatches.length < 4) return null;

        const lastFour = moneyMatches.slice(-4);
        const description = afterDate.slice(0, lastFour[0].index).trim();
        if (!description) return null;

        const [fees, moneyOut, moneyIn, balance] = lastFour.map((match) => numberFromPdf(match[1]));
        const date = isoFromStatementDate(dateMatch[0]);
        const category = inferCategory(description);
        const amount = roundMoney(moneyOut + fees);
        const base = {
            sourceFile,
            statementPeriod: '',
            account: 'EveryDay account',
            statementUploadId: uploadId,
            date,
            description,
            fees,
            moneyOut,
            moneyIn,
            balance,
        };

        if (moneyIn > 0 && /salary|salar|payroll|wage|income/i.test(description)) {
            return { type: 'salaryTransactions', item: { ...base, moneyIn } };
        }

        if (category === 'GoalSave') {
            return {
                type: 'savingsTransfers',
                item: {
                    ...base,
                    direction: moneyIn > 0 ? 'From savings' : 'To savings',
                },
            };
        }

        if (amount <= 0) return null;
        return {
            type: 'transactions',
            item: {
                ...base,
                amount,
                category,
                priority: priorityForDescription(description, category),
                merchant: inferMerchant(description),
            },
        };
    }

    function rowsFromTextItems(items) {
        const lines = new Map();
        items.forEach((item) => {
            const y = Math.round(item.transform[5]);
            const x = item.transform[4];
            if (!lines.has(y)) lines.set(y, []);
            lines.get(y).push({ x, text: item.str });
        });
        return [...lines.entries()]
            .sort((a, b) => b[0] - a[0])
            .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ').replace(/\s+/g, ' ').trim())
            .filter(Boolean);
    }

    async function parseStatementPdf(file, password, uploadId) {
        const pdfjs = window.pdfjsLib;
        if (!pdfjs) throw new Error('PDF parser is not loaded.');
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const buffer = await file.arrayBuffer();
        const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), password: password || undefined }).promise;
        const parsed = emptyDashboardData();
        parsed.generatedAt = new Date().toISOString();
        parsed.period = file.name;

        let carry = '';
        let inEveryDayAccount = false;
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
            const page = await document.getPage(pageNumber);
            const content = await page.getTextContent();
            const lines = rowsFromTextItems(content.items);
            lines.forEach((line) => {
                if (/^EveryDay account\s+\d+/i.test(line)) {
                    inEveryDayAccount = true;
                    carry = '';
                    return;
                }

                if (inEveryDayAccount && /^Closing Balance\b/i.test(line)) {
                    if (carry) {
                        const parsedLine = parseStatementLine(carry, file.name, uploadId);
                        if (parsedLine) parsed[parsedLine.type].push(parsedLine.item);
                    }
                    carry = '';
                    inEveryDayAccount = false;
                    return;
                }

                if (!inEveryDayAccount) return;

                if (/^[\s|]*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\b/.test(line)) {
                    if (carry) {
                        const parsedLine = parseStatementLine(carry, file.name, uploadId);
                        if (parsedLine) parsed[parsedLine.type].push(parsedLine.item);
                    }
                    carry = line;
                } else if (carry) {
                    carry = `${carry} ${line}`;
                }
            });
        }
        if (carry) {
            const parsedLine = parseStatementLine(carry, file.name, uploadId);
            if (parsedLine) parsed[parsedLine.type].push(parsedLine.item);
        }

        return parsed;
    }

    function mergeImportData(items) {
        return items.reduce((acc, item) => {
            acc.transactions.push(...item.transactions);
            acc.salaryTransactions.push(...item.salaryTransactions);
            acc.savingsTransfers.push(...item.savingsTransfers);
            return acc;
        }, emptyDashboardData());
    }

    function renderImportReview(data) {
        const totalCount = data.transactions.length + data.salaryTransactions.length + data.savingsTransfers.length;
        byId('reviewImportPanel').hidden = totalCount === 0;
        setText('reviewImportSummary', `${totalCount} parsed records: ${data.transactions.length} expenses, ${data.salaryTransactions.length} salaries, ${data.savingsTransfers.length} GoalSave transfers`);

        const rows = [
            ...data.salaryTransactions.map((item) => ({ ...item, type: 'Income', category: 'Salary', amount: item.moneyIn })),
            ...data.savingsTransfers.map((item) => ({ ...item, type: item.direction, category: 'GoalSave', amount: item.moneyIn || item.moneyOut })),
            ...data.transactions.map((item) => ({ ...item, type: item.priority, amount: item.amount })),
        ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);

        byId('reviewImportRows').innerHTML = rows.length
            ? rows.map((item) => `
                <tr>
                    <td>${escapeHtml(item.date)}</td>
                    <td><strong>${escapeHtml(item.merchant || inferMerchant(item.description))}</strong><span>${escapeHtml(item.description)}</span></td>
                    <td>${escapeHtml(item.category)}</td>
                    <td>${escapeHtml(item.type)}</td>
                    <td class="amount-cell">${currency.format(item.amount || 0)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="5">No transactions parsed from the uploaded PDFs.</td></tr>';
    }

    async function importLocalData() {
        if (!currentUser) return;

        const button = byId('supabaseImport');
        button.disabled = true;
        setText('supabaseStatus', 'Importing existing statement data...');
        showToast('basic', 'Import started', 'Existing statement data is being imported into Supabase.');

        try {
            await ensureProfile(currentUser);
            const accountId = await ensureAccount(currentUser.id);
            const categoryMap = await ensureCategories(currentUser.id);
            await seedKnownPayments(currentUser.id);

            const rows = buildImportRows(currentUser.id, accountId, categoryMap);
            for (const batch of chunk(rows, 400)) {
                const { error } = await client.from('transactions').upsert(batch, { onConflict: 'user_id,source_hash' });
                if (error) throw error;
            }

            setText('supabaseStatus', `Imported ${rows.length} local records into Supabase.`);
            await refreshDbStats();
            await loadDashboardFromSupabase();
            showToast('success', 'Import complete', `${rows.length} records are now synced to Supabase.`);
        } catch (error) {
            setText('supabaseStatus', error.message || 'Import failed.');
            showToast('error', 'Import failed', error.message || 'Could not import local data.');
        } finally {
            button.disabled = false;
        }
    }

    async function updateSession(session) {
        currentUser = session?.user || null;
        document.body.classList.add('bankdash-auth-ready');
        const signedIn = Boolean(currentUser) && !isPasswordRecovery;
        document.body.classList.toggle('bankdash-authenticated', signedIn);
        document.body.classList.toggle('supabase-signed-in', signedIn);
        setText('supabaseStatus', signedIn ? `Signed in as ${currentUser.email}` : 'Not signed in');
        setText('authStatus', isPasswordRecovery ? 'Create a new password' : signedIn ? `Signed in as ${currentUser.email}` : 'Sign in to continue');
        setText('userFirstName', currentUser ? firstNameFor(currentUser) : 'First Name');
        const importButton = byId('supabaseImport');
        if (importButton) importButton.disabled = !signedIn;
        await refreshDbStats();
        if (signedIn) {
            await loadAccountSettings(true);
            await refreshUploadHistory();
            await refreshRuleData();
            await loadDashboardFromSupabase();
        } else {
            window.BankDashData?.setData(emptyDashboardData());
        }
    }

    async function handleAuthSubmit(event) {
        event.preventDefault();
        const email = byId('authEmail').value.trim();
        const password = byId('authPassword').value;
        if (!email || !password) {
            setText('authStatus', 'Enter an email and password.');
            showToast('warning', 'Missing login details', 'Enter an email address and password.');
            return;
        }

        setText('authStatus', 'Signing in...');
        showToast('basic', 'Signing in', 'Checking your account details.');
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
            setText('authStatus', 'Sign in failed. Check the password or reset it.');
            showToast('error', 'Sign in failed', error.message || 'Check the email address and password.');
            return;
        }

        await updateSession(data.session);
        showToast('success', 'Signed in', `Welcome back, ${firstNameFor(data.session.user)}.`);
    }

    async function handlePasswordReset() {
        const email = byId('authEmail').value.trim();
        if (!email) {
            setText('authStatus', 'Enter your email address first.');
            showToast('warning', 'Email required', 'Enter your email address before requesting a password reset.');
            return;
        }

        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.href.split('#')[0],
        });
        if (error) {
            setText('authStatus', error.message);
            showToast('error', 'Reset failed', error.message);
            return;
        }
        setText('authStatus', 'Password reset email sent.');
        showToast('success', 'Reset email sent', 'Check your inbox for the Supabase password reset link.');
    }

    function showPasswordRecoveryForm(show) {
        isPasswordRecovery = show;
        byId('authGateForm').hidden = show;
        byId('passwordRecoveryForm').hidden = !show;
        document.body.classList.toggle('bankdash-authenticated', false);
        document.body.classList.toggle('supabase-signed-in', false);
        setText('authStatus', show ? 'Create a new password' : 'Sign in to continue');
    }

    function isPasswordRecoveryUrl() {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const query = new URLSearchParams(window.location.search);
        if (hash.get('type') === 'recovery' || query.get('type') === 'recovery') return true;
        return query.has('code') && !query.has('error') && !query.has('error_description');
    }

    async function handlePasswordRecoverySubmit(event) {
        event.preventDefault();
        const password = byId('newPassword').value;
        const confirm = byId('confirmPassword').value;
        if (!password || !confirm) {
            showToast('warning', 'Password required', 'Enter and confirm your new password.');
            return;
        }
        if (password !== confirm) {
            showToast('warning', 'Passwords do not match', 'Confirm password must match the new password.');
            return;
        }
        if (password.length < 8) {
            showToast('warning', 'Password too short', 'Use at least 8 characters.');
            return;
        }

        const { error } = await client.auth.updateUser({ password });
        if (error) {
            setText('authStatus', error.message);
            showToast('error', 'Password update failed', error.message);
            return;
        }

        await client.auth.signOut();
        await updateSession(null);
        byId('passwordRecoveryForm').reset();
        showPasswordRecoveryForm(false);
        window.history.replaceState({}, document.title, window.location.pathname);
        setText('authStatus', 'Password updated. Sign in again.');
        showToast('success', 'Password updated', 'Sign in again with your new password.');
    }

    async function handleStatementUpload(event) {
        event.preventDefault();
        if (!currentUser) return;

        const files = Array.from(byId('statementFiles').files || []);
        if (!files.length) {
            setText('uploadStatus', 'Choose at least one PDF.');
            showToast('warning', 'No PDF selected', 'Choose at least one statement PDF to upload.');
            return;
        }
        if (files.length > maxStatementFiles) {
            setText('uploadStatus', `Choose no more than ${maxStatementFiles} PDFs at a time.`);
            showToast('warning', 'Too many PDFs', `Upload a maximum of ${maxStatementFiles} statements per batch.`);
            return;
        }
        if (files.some((file) => file.type && file.type !== 'application/pdf')) {
            setText('uploadStatus', 'Only PDF statements can be uploaded.');
            showToast('warning', 'Invalid file type', 'Remove non-PDF files and try again.');
            return;
        }

        setText('uploadStatus', `Uploading ${files.length} PDF${files.length === 1 ? '' : 's'}...`);
        showToast('basic', 'Upload started', `${files.length} PDF${files.length === 1 ? '' : 's'} selected.`);
        const password = byId('statementPassword').value;
        const passwordProvided = Boolean(password);

        try {
            const parsedFiles = [];
            for (const file of files) {
                const path = `${currentUser.id}/${Date.now()}-${safeFileName(file.name)}`;
                const upload = await client.storage.from('bank-statements').upload(path, file, {
                    contentType: 'application/pdf',
                    upsert: false,
                });
                if (upload.error) throw upload.error;

                const dateParts = inferStatementDate(file.name);
                const { data: uploadRow, error } = await client.from('statement_uploads').insert({
                    user_id: currentUser.id,
                    file_name: file.name,
                    storage_path: path,
                    statement_year: dateParts.year,
                    statement_month: dateParts.month,
                    status: passwordProvided ? 'parsed_pending_review_password_provided' : 'parsed_pending_review',
                }).select('id').single();
                if (error) throw error;

                parsedFiles.push(await parseStatementPdf(file, password, uploadRow.id));
            }

            pendingImportData = mergeImportData(parsedFiles);
            renderImportReview(pendingImportData);
            byId('statementUploadForm').reset();
            setText('uploadStatus', `Uploaded and parsed ${files.length} PDF${files.length === 1 ? '' : 's'}. Review before saving.`);
            await refreshUploadHistory();
            showToast('success', 'Ready for review', 'Parsed transactions are waiting for your approval.');
        } catch (error) {
            setText('uploadStatus', error.message || 'Upload failed.');
            showToast('error', 'Upload failed', error.message || 'Could not upload statement PDFs.');
        }
    }

    function handleStatementFileSelection() {
        const input = byId('statementFiles');
        const files = Array.from(input.files || []);
        if (!files.length) {
            setText('uploadStatus', 'Ready for PDFs');
            return;
        }
        if (files.length > maxStatementFiles) {
            input.value = '';
            setText('uploadStatus', `Choose no more than ${maxStatementFiles} PDFs at a time.`);
            showToast('warning', 'Too many PDFs', `Select up to ${maxStatementFiles} statements, then upload the next batch after saving.`);
            return;
        }
        setText('uploadStatus', `${files.length} PDF${files.length === 1 ? '' : 's'} selected. Ready to upload.`);
    }

    async function saveReviewedTransactions() {
        if (!currentUser || !pendingImportData) return;

        const count = pendingImportData.transactions.length + pendingImportData.salaryTransactions.length + pendingImportData.savingsTransfers.length;
        if (!count) {
            showToast('warning', 'Nothing to save', 'Upload and parse statements before saving.');
            return;
        }

        try {
            const accountId = await ensureAccount(currentUser.id);
            const categoryMap = await ensureCategories(currentUser.id, pendingImportData);
            const rows = buildImportRows(currentUser.id, accountId, categoryMap, pendingImportData);
            for (const batch of chunk(rows, 400)) {
                const { error } = await client.from('transactions').upsert(batch, { onConflict: 'user_id,source_hash' });
                if (error) throw error;
            }

            const uploadIds = Array.from(new Set(rows.map((row) => row.statement_upload_id).filter(Boolean)));
            if (uploadIds.length) {
                const { error } = await client
                    .from('statement_uploads')
                    .update({ status: 'imported', parsed_at: new Date().toISOString() })
                    .in('id', uploadIds);
                if (error) throw error;
            }

            pendingImportData = null;
            byId('reviewImportPanel').hidden = true;
            byId('reviewImportRows').innerHTML = '';
            await refreshDbStats();
            await refreshUploadHistory();
            await refreshRuleData();
            await loadDashboardFromSupabase();
            showToast('success', 'Transactions saved', `${count} reviewed records were saved to BankDash.`);
        } catch (error) {
            showToast('error', 'Save failed', error.message || 'Could not save reviewed transactions.');
        }
    }

    function discardReviewedTransactions() {
        pendingImportData = null;
        byId('reviewImportPanel').hidden = true;
        byId('reviewImportRows').innerHTML = '';
        setText('reviewImportSummary', 'No transactions pending review');
        showToast('basic', 'Review discarded', 'Parsed transactions were removed from the review list.');
    }

    async function clearImportedData() {
        if (!currentUser) return;
        const confirmed = window.confirm('Clear imported transactions, statement upload rows, and uploaded statement files? Account settings and rules stay saved.');
        if (!confirmed) return;

        try {
            const { data: files, error: listError } = await client.storage.from('bank-statements').list(currentUser.id, { limit: 1000 });
            if (listError) throw listError;
            const paths = (files || []).map((file) => `${currentUser.id}/${file.name}`);
            if (paths.length) {
                const { error: removeError } = await client.storage.from('bank-statements').remove(paths);
                if (removeError) throw removeError;
            }
            const { error: transactionError } = await client.from('transactions').delete().eq('user_id', currentUser.id);
            if (transactionError) throw transactionError;
            const { error: uploadError } = await client.from('statement_uploads').delete().eq('user_id', currentUser.id);
            if (uploadError) throw uploadError;

            pendingImportData = null;
            discardReviewedTransactions();
            await refreshDbStats();
            await refreshUploadHistory();
            await refreshRuleData();
            await loadDashboardFromSupabase();
            showToast('success', 'Imported data cleared', 'Transactions and uploaded statements were removed. Settings were kept.');
        } catch (error) {
            showToast('error', 'Clear failed', error.message || 'Could not clear imported data.');
        }
    }

    async function handlePriorityRuleSave(event) {
        event.preventDefault();
        if (!currentUser) return;

        const name = byId('priorityRuleName').value.trim();
        const amount = Number(byId('priorityRuleAmount').value || 0);
        const match = selectedPriorityMatch || name;
        if (!name || !match) {
            setText('priorityRuleStatus', 'Enter a name and select or type a match.');
            showToast('warning', 'Priority rule incomplete', 'Enter a name and select or type a matching transaction.');
            return;
        }

        const { error } = await client.from('recurring_payments').insert({
            user_id: currentUser.id,
            name,
            merchant_match: match,
            expected_amount: amount || null,
            payment_group: 'priority',
            is_active: true,
        });

        if (error) {
            setText('priorityRuleStatus', error.message);
            showToast('error', 'Rule save failed', error.message);
            return;
        }

        setText('priorityRuleStatus', `Saved ${name}`);
        selectedPriorityMatch = null;
        byId('priorityRuleForm').reset();
        await refreshRuleData();
        showToast('success', 'Priority rule saved', `${name} will be tracked as a priority payment.`);
    }

    async function handleSignOut(event) {
        event?.preventDefault();
        event?.stopPropagation();
        const { error } = await client.auth.signOut();
        await updateSession(null);
        if (error) {
            showToast('warning', 'Signed out locally', error.message || 'Supabase did not confirm the sign out.');
            return;
        }
        showToast('basic', 'Signed out', 'Your dashboard session has ended.');
    }

    async function initSupabasePanel() {
        const panel = byId('supabasePanel');
        if (!panel) return;

        setText('supabaseUrlDisplay', config.url);
        setText('supabaseLocalStats', `${sourceData.transactions.length} expenses, ${sourceData.salaryTransactions.length} salaries, ${sourceData.savingsTransfers.length} GoalSave transfers ready`);

        byId('authGateForm').addEventListener('submit', handleAuthSubmit);
        byId('authResetPassword').addEventListener('click', handlePasswordReset);
        byId('passwordRecoveryForm').addEventListener('submit', handlePasswordRecoverySubmit);
        byId('supabaseImport').addEventListener('click', importLocalData);
        byId('statementUploadForm').addEventListener('submit', handleStatementUpload);
        byId('statementFiles').addEventListener('change', handleStatementFileSelection);
        byId('saveReviewedTransactions').addEventListener('click', saveReviewedTransactions);
        byId('discardReviewedTransactions').addEventListener('click', discardReviewedTransactions);
        byId('clearImportedData').addEventListener('click', clearImportedData);
        byId('priorityRuleForm').addEventListener('submit', handlePriorityRuleSave);
        byId('accountForm').addEventListener('submit', saveAccountSettings);
        byId('reloadAccountSettings').addEventListener('click', () => loadAccountSettings(false));
        byId('priorityRuleName').addEventListener('input', () => {
            selectedPriorityMatch = null;
            renderPrioritySuggestions();
        });
        byId('supabaseSignOut').addEventListener('click', handleSignOut);
        bindButtonActivation('.button-user-logout', handleSignOut);
        bindButtonActivation('.button-user-account', goToAccount);

        if (isPasswordRecoveryUrl()) showPasswordRecoveryForm(true);

        const { data } = await client.auth.getSession();
        await updateSession(data.session);
        client.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || isPasswordRecoveryUrl()) showPasswordRecoveryForm(true);
            updateSession(session);
        });
    }

    initSupabasePanel();
})();
