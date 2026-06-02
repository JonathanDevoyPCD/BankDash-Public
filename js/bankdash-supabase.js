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
    let primaryAccountId = null;
    let pendingImportData = null;
    let isPasswordRecovery = false;
    let appStateSyncTimer = null;
    let appStatePromptedForUserId = null;
    let pendingMfaFactorId = null;
    let pendingMfaEnrollmentId = null;

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
        expenses: 1597,
        salaries: 8,
        savingsTransfers: 55,
        totalRecords: 1660,
        income: 148750.54,
        expensesTotal: 147734.82,
        savingsIn: 18146.5,
        savingsOut: 16777,
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
        return /internet provider|fibre|fiber|isp|vehicle finance|car finance|loan provider|loan repayment|gym|fitness|rent payment|monthly rent|landlord/i
            .test(`${item.description} ${item.merchant_name || item.merchant || ''}`);
    }

    function inferCategory(description) {
        const value = description.toLowerCase();
        if (/(^|\s)fee[:\s]|transactional sms|monthly service/i.test(value)) return 'Bank fees';
        if (/goalsave/i.test(value)) return 'GoalSave';
        if (/eft for perfect circle salar|salary|salar/i.test(value)) return 'Salary';
        if (/vas - mobile purchase|data bundle|\bdata\b/i.test(value)) return 'Mobile/data';
        if (/debit order|debicheck/i.test(value)) return 'Debit orders';
        if (/vehicle finance|car finance|internet provider|fibre|fiber|isp|loan repayment/i.test(value)) return 'Fixed beneficiaries/EFT';
        if (/seattle|coffee|restaurant|bakery|bistro|kfc|mcdonald|steers|food|cafe/i.test(value)) return 'Dining & coffee';
        if (/checkers|woolworths|pick n pay|spar|grocery|grocer/i.test(value)) return 'Groceries';
        if (/fuel|engen|shell|bp |caltex|sasol|total/i.test(value)) return 'Fuel/transport';
        if (/google|youtube|openai|chatgpt|strava|netflix|spotify|subscription|patreon|discord/i.test(value)) return 'Subscriptions/software';
        if (/takealot|amazon|shop|online|purchase at/i.test(value)) return 'Shopping & online';
        if (/edge fitness|gym/i.test(value)) return 'Healthcare';
        if (/rent payment|landlord|loan provider|internet provider|vehicle finance|car finance/i.test(value)) return 'Fixed beneficiaries/EFT';
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

    function authRedirectUrl(type = 'default') {
        if (type === 'signup') return config.signupRedirectUrl || config.authRedirectUrl || window.location.href.split('#')[0].split('?')[0];
        if (type === 'password') return config.passwordRedirectUrl || config.authRedirectUrl || window.location.href.split('#')[0].split('?')[0];
        return config.authRedirectUrl || window.location.href.split('#')[0].split('?')[0];
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

    function setAuthMode(mode) {
        const isSignup = mode === 'signup';
        const isRecovery = mode === 'recovery';
        const isMfa = mode === 'mfa';
        if (!isRecovery) isPasswordRecovery = false;
        byId('authGateForm').hidden = isSignup || isRecovery || isMfa;
        byId('signupForm').hidden = !isSignup || isRecovery || isMfa;
        byId('mfaChallengeForm').hidden = !isMfa;
        byId('passwordRecoveryForm').hidden = !isRecovery;
        document.querySelectorAll('[data-auth-mode]').forEach((button) => {
            button.classList.toggle('active', button.dataset.authMode === (isSignup ? 'signup' : 'signin'));
        });
        setText('authStatus', isMfa ? 'Enter your 2FA code' : isRecovery ? 'Create a new password' : isSignup ? 'Create your BankDash account' : 'Sign in to continue');
    }

    function passwordIssues(password, context = {}) {
        const emailName = (context.email || '').split('@')[0]?.toLowerCase() || '';
        const firstName = (context.firstName || '').toLowerCase();
        const lower = String(password || '').toLowerCase();
        const issues = [];
        if (password.length < 12) issues.push('Use at least 12 characters.');
        if (!/[a-z]/.test(password)) issues.push('Add a lowercase letter.');
        if (!/[A-Z]/.test(password)) issues.push('Add an uppercase letter.');
        if (!/\d/.test(password)) issues.push('Add a number.');
        if (!/[^A-Za-z0-9]/.test(password)) issues.push('Add a symbol.');
        if (emailName && lower.includes(emailName)) issues.push('Do not include your email name.');
        if (firstName && lower.includes(firstName)) issues.push('Do not include your first name.');
        if (/(password|bankdash|qwerty|letmein|welcome|123456)/i.test(password)) issues.push('Avoid common password words.');
        return issues;
    }

    function validatePassword(password, context = {}) {
        const issues = passwordIssues(password, context);
        if (!issues.length) return true;
        setText('authStatus', issues[0]);
        showToast('warning', 'Stronger password required', issues.join(' '));
        return false;
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
        if (existing) return false;

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
        return true;
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
                institution: 'TymeBank',
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
                is_essential: ['Internet provider', 'Vehicle finance', 'Loan provider', 'Gym', 'Rent payment'].includes(name),
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
        if (!await hasAal2Session()) {
            setText('supabaseDbStats', '2FA required for protected data');
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
        if (!await requireAal2ForSensitiveData('load financial dashboard data', true)) {
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

    function currentLocalAppState() {
        return window.BankDashData?.captureAppState?.() || null;
    }

    function appStateDate(value) {
        const time = Date.parse(value || '');
        return Number.isFinite(time) ? time : 0;
    }

    function appStateChecksum(state) {
        return sourceHash(JSON.stringify(state || {}));
    }

    async function loadRemoteAppState() {
        if (!currentUser) return null;
        if (!await requireAal2ForSensitiveData('sync account data')) return null;
        const { data, error } = await client
            .from('user_app_state')
            .select('state,state_checksum,client_updated_at,updated_at')
            .eq('user_id', currentUser.id)
            .maybeSingle();
        if (error) throw error;
        return data || null;
    }

    async function pushAppStateToSupabase(options = {}) {
        if (!currentUser) return false;
        if (!await requireAal2ForSensitiveData('save account sync data', Boolean(options.quiet))) return false;
        const state = currentLocalAppState();
        if (!state) return false;

        const syncedAt = options.force || !appStateDate(state.localUpdatedAt)
            ? new Date().toISOString()
            : state.localUpdatedAt;
        const nextState = {
            ...state,
            userId: currentUser.id,
            localUpdatedAt: syncedAt,
        };

        const { error } = await client.from('user_app_state').upsert({
            user_id: currentUser.id,
            state_schema_version: 1,
            state: nextState,
            state_checksum: appStateChecksum(nextState),
            client_updated_at: syncedAt,
        }, { onConflict: 'user_id' });
        if (error) throw error;

        localStorage.setItem('bankdash.syncUpdatedAt', syncedAt);
        if (!options.quiet) showToast('success', 'Account synced', 'This browser data was saved to Supabase.');
        return true;
    }

    async function pullAppStateFromSupabase(remoteState = null, options = {}) {
        if (!currentUser) return false;
        const remote = remoteState || await loadRemoteAppState();
        if (!remote?.state) {
            if (!options.quiet) showToast('warning', 'No synced data', 'No saved account data was found in Supabase yet.');
            return false;
        }

        const syncedAt = remote.client_updated_at || remote.updated_at;
        const applied = window.BankDashData?.applyAppState?.({ ...remote.state, userId: currentUser.id }, syncedAt);
        if (applied && !options.quiet) showToast('success', 'Account synced', 'Latest saved data was loaded into this browser.');
        return Boolean(applied);
    }

    function scheduleAppStatePush() {
        if (!currentUser) return;
        window.clearTimeout(appStateSyncTimer);
        appStateSyncTimer = window.setTimeout(async () => {
            try {
                await pushAppStateToSupabase({ quiet: true });
                setText('supabaseStatus', `Synced account data for ${currentUser.email}`);
            } catch (error) {
                showToast('warning', 'Sync delayed', error.message || 'Could not save account state yet.');
            }
        }, 900);
    }

    async function checkAppStateOnLogin(options = {}) {
        if (!currentUser || appStatePromptedForUserId === currentUser.id) return;
        appStatePromptedForUserId = currentUser.id;

        try {
            const remote = await loadRemoteAppState();
            const local = currentLocalAppState();
            const localAt = appStateDate(local?.localUpdatedAt);
            const remoteAt = appStateDate(remote?.client_updated_at || remote?.updated_at);

            if (!remote) {
                showToast('info', 'Sync not set up yet', 'Click Sync Account to save this browser data to your account.');
                return;
            }
            if (remote.state?.userId && remote.state.userId !== currentUser.id) {
                showToast('error', 'Sync blocked', 'Synced data belongs to a different account and was not loaded.');
                return;
            }
            if (options.localStateReset && !remote.state?.userId) {
                showToast('warning', 'Sync needs review', 'Older synced data exists for this account but is not user-verified. Use Force New Sync from this clean browser if this is a new account.');
                return;
            }

            const checksumsDiffer = appStateChecksum(local) !== remote.state_checksum;
            if ((!localAt || remoteAt > localAt || checksumsDiffer) && window.confirm('Synced BankDash data is available for this account. Sync Account now?')) {
                await pullAppStateFromSupabase(remote, { quiet: true });
                showToast('success', 'Account synced', 'Latest saved account data was loaded.');
            }
        } catch (error) {
            showToast('warning', 'Sync check failed', error.message || 'Could not check synced account data.');
        }
    }

    async function handleAccountSync(event) {
        event?.preventDefault();
        event?.stopPropagation();
        if (!currentUser) {
            showToast('warning', 'Sign in required', 'Sign in before syncing account data.');
            return;
        }

        try {
            const remote = await loadRemoteAppState();
            const local = currentLocalAppState();
            const localAt = appStateDate(local?.localUpdatedAt);
            const remoteAt = appStateDate(remote?.client_updated_at || remote?.updated_at);

            if (!remote) {
                if (window.confirm('No synced account data exists yet. Force New Sync from this browser now?')) {
                    await pushAppStateToSupabase({ force: true });
                }
                return;
            }
            if (remote.state?.userId && remote.state.userId !== currentUser.id) {
                showToast('error', 'Sync blocked', 'Synced data belongs to a different account and was not loaded.');
                return;
            }
            if (!remote.state?.userId && !localAt) {
                if (window.confirm('Older synced data exists but is not user-verified. Force New Sync from this clean browser to replace it?')) {
                    await pushAppStateToSupabase({ force: true });
                }
                return;
            }

            if (remoteAt > localAt) {
                await pullAppStateFromSupabase(remote);
                return;
            }

            if (localAt > remoteAt) {
                if (window.confirm('This browser has newer BankDash data. Force New Sync to Supabase now?')) {
                    await pushAppStateToSupabase({ force: true });
                }
                return;
            }

            if (window.confirm('Account data already appears current. Force New Sync from this browser?')) {
                await pushAppStateToSupabase({ force: true });
            } else {
                await pullAppStateFromSupabase(remote);
            }
        } catch (error) {
            showToast('error', 'Sync failed', error.message || 'Could not sync account data.');
        }
    }

    async function verifiedTotpFactor() {
        const { data, error } = await client.auth.mfa.listFactors();
        if (error) throw error;
        return (data?.totp || data?.all || []).find((factor) => factor.factor_type === 'totp' && factor.status === 'verified')
            || (data?.totp || []).find((factor) => factor.status === 'verified')
            || null;
    }

    async function requiredMfaFactor() {
        const factor = await verifiedTotpFactor();
        if (!factor) return null;
        const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) throw error;
        return data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2' ? factor : null;
    }

    async function refreshMfaStatus() {
        if (!currentUser) return;
        try {
            const factor = await verifiedTotpFactor();
            const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
            const enabled = Boolean(factor);
            setText('mfaStatus', enabled ? `Enabled (${aal?.currentLevel || 'active'})` : 'Not enabled');
            byId('startMfaSetup').hidden = enabled;
            byId('disableMfa').hidden = !enabled;
            return { enabled, currentLevel: aal?.currentLevel || 'aal1', nextLevel: aal?.nextLevel || null };
        } catch (error) {
            setText('mfaStatus', 'Could not check 2FA');
            showToast('warning', '2FA check failed', error.message || 'Could not load MFA status.');
            return { enabled: false, currentLevel: 'unknown', nextLevel: null };
        }
    }

    async function hasAal2Session() {
        if (!currentUser) return false;
        try {
            const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
            if (error) throw error;
            return data?.currentLevel === 'aal2';
        } catch (error) {
            return false;
        }
    }

    async function requireAal2ForSensitiveData(action, quiet = false) {
        if (await hasAal2Session()) return true;
        if (!quiet) {
            showToast('warning', '2FA required', `Enable 2FA in Account Security, then verify your authenticator code to ${action}.`);
            goToAccount();
        }
        return false;
    }

    function renderMfaQr(data) {
        const qrTarget = byId('mfaQrCode');
        const secretTarget = byId('mfaSecretText');
        const totp = data?.totp || {};
        const qr = totp.qr_code || totp.svg || '';
        if (qrTarget) {
            if (String(qr).trim().startsWith('<svg')) qrTarget.innerHTML = qr;
            else if (qr) qrTarget.innerHTML = `<img src="${escapeHtml(qr)}" alt="Authenticator QR code">`;
            else qrTarget.textContent = 'QR unavailable';
        }
        if (secretTarget) secretTarget.textContent = totp.secret ? `Manual key: ${totp.secret}` : 'Scan this code with Google Authenticator.';
    }

    async function startMfaSetup() {
        if (!currentUser) return;
        try {
            const { data, error } = await client.auth.mfa.enroll({
                factorType: 'totp',
                friendlyName: 'BankDash',
            });
            if (error) throw error;
            pendingMfaEnrollmentId = data.id;
            renderMfaQr(data);
            byId('mfaSetupPanel').hidden = false;
            byId('mfaSetupCode').value = '';
            byId('mfaSetupCode').focus();
            showToast('basic', 'Scan QR code', 'Add BankDash to Google Authenticator, then enter the 6-digit code.');
        } catch (error) {
            showToast('error', '2FA setup failed', error.message || 'Could not start MFA setup.');
        }
    }

    async function verifyMfaSetup() {
        const code = byId('mfaSetupCode').value.trim();
        if (!pendingMfaEnrollmentId || !code) {
            showToast('warning', 'Code required', 'Enter the 6-digit authenticator code.');
            return;
        }
        try {
            const challenge = await client.auth.mfa.challenge({ factorId: pendingMfaEnrollmentId });
            if (challenge.error) throw challenge.error;
            const verify = await client.auth.mfa.verify({
                factorId: pendingMfaEnrollmentId,
                challengeId: challenge.data.id,
                code,
            });
            if (verify.error) throw verify.error;
            pendingMfaEnrollmentId = null;
            byId('mfaSetupPanel').hidden = true;
            byId('mfaSetupCode').value = '';
            await refreshMfaStatus();
            if (await hasAal2Session()) {
                await refreshUploadHistory();
                await loadDashboardFromSupabase();
                await checkAppStateOnLogin();
            }
            showToast('success', '2FA enabled', 'BankDash will ask for your authenticator code when you sign in.');
        } catch (error) {
            showToast('error', '2FA verification failed', error.message || 'Check the code and try again.');
        }
    }

    async function disableMfa() {
        if (!currentUser) return;
        const factor = await verifiedTotpFactor();
        if (!factor) {
            await refreshMfaStatus();
            return;
        }
        if (!window.confirm('Disable two-factor authentication for this account?')) return;
        const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (error) {
            showToast('error', '2FA disable failed', error.message || 'Could not disable MFA.');
            return;
        }
        await refreshMfaStatus();
        showToast('success', '2FA disabled', 'Authenticator login protection was removed.');
    }

    async function handleMfaChallengeSubmit(event) {
        event.preventDefault();
        const code = byId('mfaChallengeCode').value.trim();
        if (!pendingMfaFactorId || !code) {
            showToast('warning', '2FA code required', 'Enter your authenticator code.');
            return;
        }
        try {
            const challenge = await client.auth.mfa.challenge({ factorId: pendingMfaFactorId });
            if (challenge.error) throw challenge.error;
            const verify = await client.auth.mfa.verify({
                factorId: pendingMfaFactorId,
                challengeId: challenge.data.id,
                code,
            });
            if (verify.error) throw verify.error;
            pendingMfaFactorId = null;
            byId('mfaChallengeCode').value = '';
            const { data } = await client.auth.getSession();
            await updateSession(data.session);
            showToast('success', '2FA verified', 'Your secure session is active.');
        } catch (error) {
            showToast('error', '2FA failed', error.message || 'Check your authenticator code and try again.');
        }
    }

    async function loadAccountSettings(quiet = false) {
        if (!currentUser) return { profileCreated: false };

        try {
            const profileCreated = await ensureProfile(currentUser);
            const { data: profile, error: profileError } = await client
                .from('profiles')
                .select('first_name,last_name,display_name,phone,currency_code,timezone,financial_cycle_start_day,monthly_income_target,default_goalsave_target,coffee_budget_cap,statement_password_hint')
                .eq('id', currentUser.id)
                .single();
            if (profileError) throw profileError;

            let accounts = [];
            const canLoadSensitiveData = await hasAal2Session();
            if (canLoadSensitiveData) {
                const accountResponse = await client
                    .from('accounts')
                    .select('id,name,institution,account_mask,is_primary')
                    .eq('user_id', currentUser.id)
                    .order('is_primary', { ascending: false })
                    .order('created_at', { ascending: true })
                    .limit(1);
                if (accountResponse.error) throw accountResponse.error;
                accounts = accountResponse.data || [];
            } else if (!quiet) {
                showToast('warning', '2FA required', 'Bank account details stay locked until you enable 2FA and verify your session.');
            }

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
            setValue('accountInstitution', account?.institution || 'TymeBank');
            setValue('accountMask', account?.account_mask || '');

            setText('accountDisplayName', displayName);
            setText('accountEmail', currentUser.email);
            setText('accountInitials', initialsFor(firstName, lastName, currentUser.email));
            setText('userFirstName', firstName);

            if (!quiet) showToast('basic', 'Account loaded', 'Your saved account settings are shown.');
            return { profileCreated, profile };
        } catch (error) {
            showToast('error', 'Account load failed', error.message || 'Could not load your account settings.');
            return { profileCreated: false };
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

            let bankDetailsSaved = false;
            if (await hasAal2Session()) {
                const accountPayload = {
                    user_id: currentUser.id,
                    name: byId('accountBankName').value.trim() || 'EveryDay account',
                    institution: byId('accountInstitution').value.trim() || 'TymeBank',
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
                bankDetailsSaved = true;
            }

            await client.auth.updateUser({ data: { first_name: firstName, full_name: displayName, bankdash_onboarded: true } });
            setText('accountDisplayName', displayName);
            setText('accountEmail', currentUser.email);
            setText('accountInitials', initialsFor(firstName, lastName, currentUser.email));
            setText('userFirstName', firstName);
            showToast('success', 'Account saved', bankDetailsSaved
                ? 'Your profile, dashboard preferences, and bank details were updated.'
                : 'Your profile was saved. Enable 2FA to save bank details.');
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
        if (!await requireAal2ForSensitiveData('view uploaded statement history', true)) {
            setText('uploadHistory', 'Enable 2FA to view uploads');
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

        if (moneyIn > 0 && /salary|salar|eft for perfect circle/i.test(description)) {
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
        if (!await requireAal2ForSensitiveData('import statement data')) return;

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
        let mfaFactor = null;
        if (signedIn) {
            try {
                mfaFactor = await requiredMfaFactor();
            } catch (error) {
                showToast('warning', '2FA check failed', error.message || 'Could not check MFA status.');
            }
        }
        const authenticated = signedIn && !mfaFactor;
        document.body.classList.toggle('bankdash-authenticated', authenticated);
        document.body.classList.toggle('supabase-signed-in', authenticated);
        setText('supabaseStatus', signedIn ? `Signed in as ${currentUser.email}` : 'Not signed in');
        setText('authStatus', isPasswordRecovery ? 'Create a new password' : authenticated ? `Signed in as ${currentUser.email}` : 'Sign in to continue');
        setText('userFirstName', currentUser ? firstNameFor(currentUser) : 'First Name');
        const importButton = byId('supabaseImport');
        if (importButton) importButton.disabled = !authenticated;
        if (mfaFactor) {
            pendingMfaFactorId = mfaFactor.id;
            setAuthMode('mfa');
            setText('supabaseStatus', 'Two-factor verification required');
            return;
        }
        await refreshDbStats();
        if (authenticated) {
            window.BankDashData?.setData(emptyDashboardData());
            const localStateReset = window.BankDashData?.prepareForUser?.(currentUser.id);
            if (localStateReset) {
                showToast('info', 'Clean account workspace', 'Local dashboard data was reset because a different account is signed in on this browser.');
            }
            const accountLoad = await loadAccountSettings(true);
            const mfaStatus = await refreshMfaStatus();
            if (!mfaStatus?.enabled) {
                goToAccount();
                showToast('warning', '2FA required', 'Set up Google Authenticator in Account Security to unlock synced and financial data.');
                return;
            }
            await refreshUploadHistory();
            await loadDashboardFromSupabase();
            if (accountLoad?.profileCreated) {
                await pushAppStateToSupabase({ force: true, quiet: true });
                goToAccount();
                showToast('info', 'Finish account setup', 'Set your profile, currency, cycle day, and dashboard defaults before using BankDash.');
            } else {
                await checkAppStateOnLogin({ localStateReset });
            }
        } else {
            pendingMfaFactorId = null;
            appStatePromptedForUserId = null;
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

    async function handleSignUpSubmit(event) {
        event.preventDefault();
        const firstName = byId('signupFirstName').value.trim();
        const email = byId('signupEmail').value.trim();
        const password = byId('signupPassword').value;
        const confirmPassword = byId('signupConfirmPassword').value;
        if (!firstName || !email || !password || !confirmPassword) {
            setText('authStatus', 'Complete all signup fields.');
            showToast('warning', 'Signup incomplete', 'Enter your first name, email address, and password.');
            return;
        }
        if (password !== confirmPassword) {
            setText('authStatus', 'Passwords do not match.');
            showToast('warning', 'Passwords do not match', 'Confirm password must match the password field.');
            return;
        }
        if (!validatePassword(password, { email, firstName })) return;

        setText('authStatus', 'Creating account...');
        showToast('basic', 'Creating account', 'Setting up your BankDash login.');
        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: authRedirectUrl('signup'),
                data: {
                    first_name: firstName,
                    full_name: firstName,
                },
            },
        });
        if (error) {
            setText('authStatus', error.message);
            showToast('error', 'Signup failed', error.message || 'Could not create your account.');
            return;
        }

        byId('signupForm').reset();
        if (data.session) {
            await updateSession(data.session);
            goToAccount();
            showToast('success', 'Account created', 'Finish your account setup before using BankDash.');
            return;
        }

        setAuthMode('signin');
        setText('authStatus', 'Check your email to confirm your account, then sign in.');
        setValue('authEmail', email);
        showToast('success', 'Confirm your email', 'Supabase sent a confirmation link. Use it before signing in.');
    }

    async function handlePasswordReset() {
        const email = byId('authEmail').value.trim();
        if (!email) {
            setText('authStatus', 'Enter your email address first.');
            showToast('warning', 'Email required', 'Enter your email address before requesting a password reset.');
            return;
        }

        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: authRedirectUrl('password'),
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
        setAuthMode(show ? 'recovery' : 'signin');
        document.body.classList.toggle('bankdash-authenticated', false);
        document.body.classList.toggle('supabase-signed-in', false);
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
        if (!validatePassword(password, { email: currentUser?.email || byId('authEmail')?.value || '' })) return;

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
        if (!await requireAal2ForSensitiveData('upload statement PDFs')) return;

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
        if (!await requireAal2ForSensitiveData('save reviewed transactions')) return;

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
        if (!await requireAal2ForSensitiveData('clear bank activity data')) return;
        const confirmed = window.confirm('Clear Bank Activity only? This removes parsed statement transactions, statement upload rows, and uploaded statement PDFs. Account settings, checklist data, banks, cards, and manual dashboard setup stay saved.');
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
            await loadDashboardFromSupabase();
            showToast('success', 'Bank Activity cleared', 'Statement transactions and uploaded PDFs were removed. Your other dashboard data was kept.');
        } catch (error) {
            showToast('error', 'Clear failed', error.message || 'Could not clear Bank Activity data.');
        }
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

    async function handleGlobalSignOut() {
        if (!window.confirm('Sign out this account on all devices?')) return;
        const { error } = await client.auth.signOut({ scope: 'global' });
        await updateSession(null);
        if (error) {
            showToast('warning', 'Signed out locally', error.message || 'Could not confirm global sign out.');
            return;
        }
        showToast('success', 'Signed out everywhere', 'All active sessions for this account were ended.');
    }

    async function handleSecurityPasswordReset() {
        if (!currentUser?.email) return;
        const { error } = await client.auth.resetPasswordForEmail(currentUser.email, {
            redirectTo: authRedirectUrl('password'),
        });
        if (error) {
            showToast('error', 'Reset failed', error.message || 'Could not send password reset email.');
            return;
        }
        showToast('success', 'Reset email sent', 'Check your inbox for the password reset link.');
    }

    function handleClearLocalBrowserData() {
        if (!currentUser) return;
        if (!window.confirm('Clear local browser data for this account on this device? Synced Supabase data is not deleted.')) return;
        window.BankDashData?.resetLocalAppStateForUser?.(currentUser.id);
        showToast('success', 'Local data cleared', 'This browser now has a clean local BankDash workspace for the signed-in account.');
    }

    function handleClearPrivateCardData() {
        const cleared = window.BankDashData?.clearPrivateCardData?.();
        if (cleared) showToast('success', 'Card details cleared', 'Saved private card fields were removed from this browser.');
    }

    async function initSupabasePanel() {
        const panel = byId('supabasePanel');
        if (!panel) return;

        setText('supabaseUrlDisplay', config.url);
        setText('supabaseLocalStats', `${sourceData.transactions.length} expenses, ${sourceData.salaryTransactions.length} salaries, ${sourceData.savingsTransfers.length} GoalSave transfers ready`);

        byId('authGateForm').addEventListener('submit', handleAuthSubmit);
        byId('signupForm').addEventListener('submit', handleSignUpSubmit);
        byId('mfaChallengeForm').addEventListener('submit', handleMfaChallengeSubmit);
        byId('mfaChallengeSignOut').addEventListener('click', handleSignOut);
        byId('showSignIn').addEventListener('click', () => setAuthMode('signin'));
        byId('showSignUp').addEventListener('click', () => setAuthMode('signup'));
        byId('authResetPassword').addEventListener('click', handlePasswordReset);
        byId('passwordRecoveryForm').addEventListener('submit', handlePasswordRecoverySubmit);
        byId('supabaseImport').addEventListener('click', importLocalData);
        byId('statementUploadForm').addEventListener('submit', handleStatementUpload);
        byId('statementFiles').addEventListener('change', handleStatementFileSelection);
        byId('saveReviewedTransactions').addEventListener('click', saveReviewedTransactions);
        byId('discardReviewedTransactions').addEventListener('click', discardReviewedTransactions);
        byId('clearImportedData').addEventListener('click', clearImportedData);
        byId('accountForm').addEventListener('submit', saveAccountSettings);
        byId('reloadAccountSettings').addEventListener('click', () => loadAccountSettings(false));
        byId('startMfaSetup').addEventListener('click', startMfaSetup);
        byId('verifyMfaSetup').addEventListener('click', verifyMfaSetup);
        byId('cancelMfaSetup').addEventListener('click', () => {
            pendingMfaEnrollmentId = null;
            byId('mfaSetupPanel').hidden = true;
        });
        byId('disableMfa').addEventListener('click', disableMfa);
        byId('securityResetPassword').addEventListener('click', handleSecurityPasswordReset);
        byId('signOutAllDevices').addEventListener('click', handleGlobalSignOut);
        byId('clearLocalBrowserData').addEventListener('click', handleClearLocalBrowserData);
        byId('clearPrivateCardData').addEventListener('click', handleClearPrivateCardData);
        byId('supabaseSignOut').addEventListener('click', handleSignOut);
        bindButtonActivation('.button-user-logout', handleSignOut);
        bindButtonActivation('.button-user-account', goToAccount);
        bindButtonActivation('.button-user-sync', handleAccountSync);
        window.addEventListener('bankdash:app-state-changed', scheduleAppStatePush);

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
