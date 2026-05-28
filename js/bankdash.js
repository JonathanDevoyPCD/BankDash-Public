(function () {
    const emptySourceData = {
        generatedAt: new Date().toISOString(),
        period: 'No imported statements',
        totals: {},
        monthly: [],
        salaryTransactions: [],
        savingsTransfers: [],
        transactions: [],
    };
    let sourceData = normalizeSourceData(window.BANKDASH_LIVE_DATA || emptySourceData);
    const currency = new Intl.NumberFormat('en-ZA', {
        style: 'currency',
        currency: 'ZAR',
        minimumFractionDigits: 2,
    });

    let activeFilter = 'all';
    let selectedMode = 'range';
    let selectedRange = '1';
    let selectedMonth = '';
    let privacyOn = true;
    let searchTerm = '';
    let currentData = null;
    let charts = [];
    let userSettings = null;

    const formatMoney = (value) => currency.format(value || 0);
    const moneyHtml = (value) => `<span class="money-value">${formatMoney(value)}</span>`;
    const byId = (id) => document.getElementById(id);
    const roundMoney = (value) => Math.round(value * 100) / 100;
    const monthNames = [
        ['01', 'Jan'],
        ['02', 'Feb'],
        ['03', 'Mar'],
        ['04', 'Apr'],
        ['05', 'May'],
        ['06', 'Jun'],
        ['07', 'Jul'],
        ['08', 'Aug'],
        ['09', 'Sep'],
        ['10', 'Oct'],
        ['11', 'Nov'],
        ['12', 'Dec'],
    ];
    const planningVersion = '2026-06-priority-plan';
    const essentialRules = [
        {
            label: 'Internet provider',
            matcher: (item) => /internet|fibre|fiber|provider/i.test(item.description),
        },
        {
            label: 'Vehicle finance',
            matcher: (item) => /vehicle finance|car finance|auto finance/i.test(item.description),
        },
        {
            label: 'Loan provider',
            matcher: (item) => /loan|credit provider|finance provider/i.test(item.description),
        },
        {
            label: 'Gym',
            matcher: (item) => /gym|fitness/i.test(item.description),
        },
        {
            label: 'Rent',
            matcher: (item) => /rent|landlord/i.test(item.description),
        },
    ];
    const allowedGoogleRules = [
        { label: 'Google One', amount: 34.99, matcher: (item) => /Google One/i.test(`${item.merchant} ${item.description}`) },
        { label: 'YouTube Premium', amount: 81.99, matcher: (item) => /YouTubePremium|YouTube Premium/i.test(`${item.merchant} ${item.description}`) },
    ];
    const junePriorityPlan = [
        { label: 'Rent', detail: 'Landlord', planned: 1500, matcher: (item) => /rent|landlord/i.test(item.description) },
        { label: 'Car installments', detail: 'Vehicle finance', planned: 3000, matcher: (item) => /vehicle finance|car finance|auto finance/i.test(item.description) },
        { label: 'Petrol', detail: 'Monthly cap', planned: 1500, category: 'Fuel/transport' },
        { label: 'Internet', planned: 1500, matcher: (item) => /internet|fibre|fiber|provider/i.test(item.description) },
        { label: 'Loans', planned: 700, matcher: (item) => /loan|credit provider|finance provider/i.test(item.description) },
        { label: 'Gym', planned: 250, matcher: (item) => /gym|fitness/i.test(item.description) },
        { label: 'Groceries', detail: 'Monthly cap', planned: 1500, category: 'Groceries' },
        { label: 'Leisure', detail: 'Monthly cap', planned: 1500, category: 'Leisure' },
        { label: 'Saving', detail: 'GoalSave monthly target', planned: 1500 },
        { label: 'ChatGPT', planned: 399, matcher: (item) => /OPENAI|ChatGPT/i.test(`${item.merchant} ${item.description}`) },
        { label: 'Google One', planned: 34.99, matcher: (item) => /Google One/i.test(`${item.merchant} ${item.description}`) },
        { label: 'YouTube Premium', planned: 81.99, matcher: (item) => /YouTubePremium|YouTube Premium/i.test(`${item.merchant} ${item.description}`) },
    ];
    const priorityItemDefinitions = [
        { key: 'rent', label: 'Rent', detail: 'Landlord', fallback: 1500, matcher: (item) => /rent|landlord/i.test(item.description) },
        { key: 'vehicle', label: 'Vehicle', detail: 'Vehicle finance', fallback: 3000, matcher: (item) => /vehicle finance|car finance|auto finance/i.test(item.description) },
        { key: 'petrol', label: 'Petrol', detail: 'Multiple Stations', fallback: 1500, category: 'Fuel/transport' },
        { key: 'internet', label: 'Internet & Fibre', detail: 'Internet provider', fallback: 1500, matcher: (item) => /internet|fibre|fiber|provider/i.test(item.description) },
        { key: 'loans', label: 'Loans', detail: 'Loan provider', fallback: 700, matcher: (item) => /loan|credit provider|finance provider/i.test(item.description) },
        { key: 'gym', label: 'Gym', detail: 'Fitness provider', fallback: 250, matcher: (item) => /gym|fitness/i.test(item.description) },
        { key: 'groceries', label: 'Groceries', detail: 'Multiple Stores', fallback: 1500, category: 'Groceries' },
        { key: 'airtime', label: 'Airtime/Data', detail: 'Mobile & data', fallback: 450, category: 'Mobile/data' },
        { key: 'lunch', label: 'Lunch', detail: 'Food & work meals', fallback: 0, matcher: (item) => /lunch|kfc|mcdonald|steers|nando|burger|restaurant|takealot foods|uber eats|mr d|food/i.test(`${item.merchant} ${item.description}`) },
        { key: 'leisure', label: 'Leisure', detail: 'Various', fallback: 1500, categories: ['Leisure', 'Dining & coffee'] },
        { key: 'coffee', label: 'Coffee', detail: 'Coffee shops', fallback: 0, matcher: (item) => /coffee|seattle|starbucks|vida|mugg|roast/i.test(`${item.merchant} ${item.description}`) },
        { key: 'savings', label: 'Savings', detail: 'GoalSave', fallback: 1500, savings: true },
        { key: 'openai', label: 'ChatGPT', detail: 'OpenAI', fallback: 399, matcher: (item) => /OPENAI|ChatGPT/i.test(`${item.merchant} ${item.description}`) },
        { key: 'google', label: 'Google', detail: 'Google One', fallback: 34.99, matcher: (item) => /Google One/i.test(`${item.merchant} ${item.description}`) },
        { key: 'youtube', label: 'YouTube', detail: 'YouTube Premium', fallback: 81.99, matcher: (item) => /YouTubePremium|YouTube Premium/i.test(`${item.merchant} ${item.description}`) },
    ];
    const juneInactiveCosts = [
        'Strava',
        'Patreon',
        'GOOGLE ADS8580037692',
        'Coffee',
        'Vehicle Finance',
    ];
    const defaultBudgets = {
        'Dining & coffee': 0,
        Groceries: 1500,
        Leisure: 1500,
        'Subscriptions/software': 600,
        'Shopping & online': 2000,
        'Fuel/transport': 1500,
        'Mobile/data': 450,
    };
    const fixedJuneBudgetTargets = {
        'Dining & coffee': 0,
        Groceries: 1500,
        Leisure: 1500,
        'Fuel/transport': 1500,
    };
    const categoryOptions = [
        'Bank fees',
        'Debit orders',
        'Dining & coffee',
        'Fixed beneficiaries/EFT',
        'Fuel/transport',
        'Groceries',
        'Healthcare',
        'Leisure',
        'Mobile/data',
        'Other',
        'Shopping & online',
        'Subscriptions/software',
    ];
    userSettings = loadSettings();
    const pct = (part, total) => `${Math.round((part / Math.max(total, 1)) * 100)}%`;
    const escapeHtml = (value) =>
        String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');

    function normalizeSourceData(data) {
        return {
            ...emptySourceData,
            ...(data || {}),
            transactions: Array.isArray(data?.transactions) ? data.transactions : [],
            salaryTransactions: Array.isArray(data?.salaryTransactions) ? data.salaryTransactions : [],
            savingsTransfers: Array.isArray(data?.savingsTransfers) ? data.savingsTransfers : [],
        };
    }

    function salaryDeposits() {
        return [...sourceData.salaryTransactions].sort((a, b) => a.date.localeCompare(b.date));
    }

    function allKnownDates() {
        return [
            ...sourceData.transactions.map((item) => item.date),
            ...sourceData.savingsTransfers.map((item) => item.date),
            ...sourceData.salaryTransactions.map((item) => item.date),
        ].filter(Boolean).sort();
    }

    function lastKnownDate() {
        const dates = allKnownDates();
        return dates[dates.length - 1] || '';
    }

    function setDashboardSourceData(nextData) {
        sourceData = normalizeSourceData(nextData);
        populateMonthControls();
        populateManualCycleControls();
        renderDashboard();
        applyPrivacyState();
    }

    function setText(id, value) {
        const node = byId(id);
        if (node) node.textContent = value;
    }

    function showLocalToast(type, title, message) {
        const stack = byId('toastStack');
        if (!stack) return;
        const tone = ['success', 'warning', 'error', 'basic', 'info'].includes(type) ? type : 'basic';
        const toast = document.createElement('div');
        toast.className = `bankdash-toast ${tone}`;
        toast.innerHTML = `
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(message || '')}</span>
        `;
        stack.appendChild(toast);
        window.setTimeout(() => toast.remove(), tone === 'error' ? 6500 : 4200);
    }

    function loadSettings() {
        try {
            const savedVersion = localStorage.getItem('bankdash.planningVersion');
            const savedBudgets = JSON.parse(localStorage.getItem('bankdash.budgets')) || {};
            const useNewPlanDefaults = savedVersion !== planningVersion;
            return {
                budgets: useNewPlanDefaults ? { ...defaultBudgets } : { ...defaultBudgets, ...savedBudgets },
                goalSaveTarget: useNewPlanDefaults ? 1500 : Number(localStorage.getItem('bankdash.goalSaveTarget') || 1500),
                merchantOverrides: JSON.parse(localStorage.getItem('bankdash.merchantOverrides')) || {},
                categoryOverrides: JSON.parse(localStorage.getItem('bankdash.categoryOverrides')) || {},
                priorityChecklist: JSON.parse(localStorage.getItem('bankdash.priorityChecklist')) || {
                    targets: {},
                    cycleTargets: {},
                    cycleSpent: {},
                    statuses: {},
                },
                manualOverview: JSON.parse(localStorage.getItem('bankdash.manualOverview')) || {
                    activeCycle: currentManualCycleStart(),
                    lastSeenCycle: currentManualCycleStart(),
                    cycles: {},
                },
            };
        } catch (error) {
            return {
                budgets: { ...defaultBudgets },
                goalSaveTarget: 1500,
                merchantOverrides: {},
                categoryOverrides: {},
                priorityChecklist: { targets: {}, cycleTargets: {}, cycleSpent: {}, statuses: {} },
                manualOverview: { activeCycle: currentManualCycleStart(), lastSeenCycle: currentManualCycleStart(), cycles: {} },
            };
        }
    }

    function saveSettings() {
        localStorage.setItem('bankdash.planningVersion', planningVersion);
        localStorage.setItem('bankdash.budgets', JSON.stringify(userSettings.budgets));
        localStorage.setItem('bankdash.goalSaveTarget', String(userSettings.goalSaveTarget || 0));
        localStorage.setItem('bankdash.merchantOverrides', JSON.stringify(userSettings.merchantOverrides));
        localStorage.setItem('bankdash.categoryOverrides', JSON.stringify(userSettings.categoryOverrides));
        localStorage.setItem('bankdash.priorityChecklist', JSON.stringify(userSettings.priorityChecklist || {
            targets: {},
            cycleTargets: {},
            cycleSpent: {},
            statuses: {},
        }));
        localStorage.setItem('bankdash.manualOverview', JSON.stringify(userSettings.manualOverview || {
            activeCycle: currentManualCycleStart(),
            lastSeenCycle: currentManualCycleStart(),
            cycles: {},
        }));
    }

    function transactionKey(item) {
        return `${item.date}|${item.amount}|${item.description}`;
    }

    function priorityForCategory(category, fallback) {
        return ['Dining & coffee', 'Leisure', 'Other', 'Shopping & online', 'Subscriptions/software'].includes(category)
            ? 'non-priority'
            : fallback;
    }

    function applyOverrides(item) {
        const key = transactionKey(item);
        const category = userSettings.categoryOverrides[key] || item.category;
        return {
            ...item,
            originalMerchant: item.merchant,
            merchant: userSettings.merchantOverrides[item.merchant] || item.merchant,
            category,
            priority: priorityForCategory(category, item.priority),
        };
    }

    function applyPrivacyState() {
        document.body.classList.toggle('privacy-on', privacyOn);
        const button = byId('privacyToggle');
        button.classList.toggle('active', privacyOn);
        button.setAttribute('aria-pressed', String(privacyOn));
        button.title = privacyOn ? 'Privacy on: amounts are hidden' : 'Privacy off: amounts are visible';
        button.innerHTML = privacyOn
            ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i><span>Privacy On</span>'
            : '<i class="fa-solid fa-eye" aria-hidden="true"></i><span>Privacy Off</span>';
    }

    function dateFromIso(date) {
        const [year, month, day] = date.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    function isoDate(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');
    }

    function addMonths(date, count) {
        const next = new Date(date);
        next.setMonth(next.getMonth() + count);
        return next;
    }

    function financialMonthStartFor(date) {
        const value = dateFromIso(date);
        if (value.getDate() < 25) value.setMonth(value.getMonth() - 1);
        value.setDate(25);
        return isoDate(value);
    }

    function salaryCycleStartFor(date) {
        const value = dateFromIso(date);
        value.setDate(25);
        return isoDate(value);
    }

    function nextFinancialMonthStart(start) {
        return isoDate(addMonths(dateFromIso(start), 1));
    }

    function previousDay(date) {
        const value = dateFromIso(date);
        value.setDate(value.getDate() - 1);
        return isoDate(value);
    }

    function currentManualCycleStart() {
        const value = new Date();
        if (value.getDate() < 25) value.setMonth(value.getMonth() - 1);
        value.setDate(25);
        return isoDate(value);
    }

    function manualCycleEndExclusive(start) {
        return nextFinancialMonthStart(start);
    }

    function manualCycleLabelFor(start) {
        return `${start} to ${previousDay(manualCycleEndExclusive(start))}`;
    }

    function ensureManualOverviewSettings() {
        userSettings.manualOverview = userSettings.manualOverview || { activeCycle: currentManualCycleStart(), cycles: {} };
        userSettings.manualOverview.activeCycle = userSettings.manualOverview.activeCycle || currentManualCycleStart();
        userSettings.manualOverview.lastSeenCycle = userSettings.manualOverview.lastSeenCycle || userSettings.manualOverview.activeCycle;
        userSettings.manualOverview.cycles = userSettings.manualOverview.cycles || {};
        return userSettings.manualOverview;
    }

    function rolloverManualCycleIfNeeded() {
        const manual = ensureManualOverviewSettings();
        const currentCycle = currentManualCycleStart();
        if (manual.lastSeenCycle === currentCycle) return;
        manual.activeCycle = currentCycle;
        manual.lastSeenCycle = currentCycle;
        manual.cycles[currentCycle] = manual.cycles[currentCycle] || {};
        saveSettings();
    }

    function activeManualCycleStart() {
        return ensureManualOverviewSettings().activeCycle;
    }

    function manualOverviewData() {
        const manual = ensureManualOverviewSettings();
        const cycle = activeManualCycleStart();
        manual.cycles[cycle] = manual.cycles[cycle] || {};
        return manual.cycles[cycle];
    }

    function manualCycleDaysLeft() {
        const cycle = activeManualCycleStart();
        const today = new Date();
        const start = dateFromIso(cycle);
        const end = dateFromIso(manualCycleEndExclusive(cycle));
        if (today < start) return Math.max(0, Math.ceil((end - start) / 86400000));
        if (today >= end) return 0;
        return Math.max(0, Math.ceil((end - today) / 86400000));
    }

    function averageValues(cycles, key) {
        if (!cycles.length) return 0;
        return roundMoney(cycles.reduce((sum, item) => sum + item[key], 0) / cycles.length);
    }

    function inCycle(date, cycle) {
        return date >= cycle.start && date < cycle.endExclusive;
    }

    function buildFinancialCycles() {
        const knownDates = allKnownDates();
        if (!knownDates.length) return [];
        const cycles = [];
        let start = financialMonthStartFor(knownDates[0]);
        const lastStart = financialMonthStartFor(lastKnownDate());

        while (start <= lastStart) {
            const endExclusive = nextFinancialMonthStart(start);
            const endDate = previousDay(endExclusive);
            const transactions = sourceData.transactions.filter((item) => inCycle(item.date, { start, endExclusive }));
            const savingsTransfers = sourceData.savingsTransfers.filter((item) => inCycle(item.date, { start, endExclusive }));
            const salaryTransactions = salaryDeposits().filter((item) => salaryCycleStartFor(item.date) === start);
            const totals = transactions.reduce(
                (acc, item) => {
                    acc.expenses = roundMoney(acc.expenses + item.amount);
                    acc[item.priority === 'priority' ? 'priority' : 'nonPriority'] = roundMoney(
                        acc[item.priority === 'priority' ? 'priority' : 'nonPriority'] + item.amount,
                    );
                    return acc;
                },
                { income: 0, otherInflows: 0, expenses: 0, priority: 0, nonPriority: 0, savingsIn: 0, savingsOut: 0, bankFees: 0 },
            );

            salaryTransactions.forEach((item) => {
                totals.income = roundMoney(totals.income + item.moneyIn);
            });

            savingsTransfers.forEach((item) => {
                if (item.direction === 'To savings') totals.savingsIn = roundMoney(totals.savingsIn + item.moneyOut + item.fees);
                if (item.direction === 'From savings') totals.savingsOut = roundMoney(totals.savingsOut + item.moneyIn);
            });

            cycles.push({
                label: `${start} to ${endDate}`,
                month: start,
                start,
                endExclusive,
                salaryTransactions,
                transactions,
                savingsTransfers,
                ...totals,
            });
            start = endExclusive;
        }

        return cycles;
    }

    function completedFinancialCycles() {
        const cycles = buildFinancialCycles();
        const latestDate = lastKnownDate();
        const completeCycles = cycles.filter((cycle) => cycle.endExclusive <= latestDate);
        return completeCycles.length ? completeCycles : cycles;
    }

    function selectedCycles() {
        const cycles = selectedMode === 'month' ? buildFinancialCycles() : completedFinancialCycles();
        if (selectedMode === 'month') {
            return cycles.filter((cycle) => cycle.start.slice(0, 7) === selectedMonth);
        }
        if (selectedRange === 'all') return cycles;
        const count = Math.min(Number(selectedRange), cycles.length);
        return cycles.slice(-count);
    }

    function periodLabel(cycles) {
        if (cycles.length === 0) return '';
        if (cycles.length === 1) return cycles[0].label;
        return `${cycles[0].start} to ${cycles[cycles.length - 1].label.split(' to ')[1]}`;
    }

    function totalsFor(cycles) {
        return cycles.reduce(
            (acc, item) => {
                ['income', 'otherInflows', 'expenses', 'priority', 'nonPriority', 'savingsIn', 'savingsOut', 'bankFees'].forEach((key) => {
                    acc[key] = roundMoney(acc[key] + item[key]);
                });
                return acc;
            },
            { income: 0, otherInflows: 0, expenses: 0, priority: 0, nonPriority: 0, savingsIn: 0, savingsOut: 0, bankFees: 0 },
        );
    }

    function totalsFromCurrent(cycles, transactions, savingsTransfers) {
        const totals = cycles.reduce(
            (acc, item) => {
                acc.income = roundMoney(acc.income + item.income);
                return acc;
            },
            { income: 0, otherInflows: 0, expenses: 0, priority: 0, nonPriority: 0, savingsIn: 0, savingsOut: 0, bankFees: 0 },
        );

        transactions.forEach((item) => {
            totals.expenses = roundMoney(totals.expenses + item.amount);
            totals[item.priority === 'priority' ? 'priority' : 'nonPriority'] = roundMoney(
                totals[item.priority === 'priority' ? 'priority' : 'nonPriority'] + item.amount,
            );
            if (item.category === 'Bank fees') totals.bankFees = roundMoney(totals.bankFees + item.amount);
        });

        savingsTransfers.forEach((item) => {
            if (item.direction === 'To savings') totals.savingsIn = roundMoney(totals.savingsIn + item.moneyOut + item.fees);
            if (item.direction === 'From savings') totals.savingsOut = roundMoney(totals.savingsOut + item.moneyIn);
        });

        return totals;
    }

    function groupPayments(transactions) {
        const groups = new Map();
        transactions.forEach((item) => {
            const current = groups.get(item.category) || {
                category: item.category,
                amount: 0,
                count: 0,
                priority: item.priority,
                transactions: [],
            };
            current.amount = roundMoney(current.amount + item.amount);
            current.count += 1;
            current.transactions.push(item);
            groups.set(item.category, current);
        });
        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                transactions: group.transactions.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount),
            }))
            .sort((a, b) => b.amount - a.amount);
    }

    function groupEssentialPayments(transactions) {
        return essentialRules
            .map((rule) => {
                const matches = transactions
                    .filter((item) => rule.matcher(item))
                    .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);

                return {
                    category: rule.label,
                    amount: roundMoney(matches.reduce((sum, item) => sum + item.amount, 0)),
                    count: matches.length,
                    transactions: matches,
                };
            })
            .filter((item) => item.count > 0);
    }

    function estimateFollowingMonth(cycles) {
        const allCycles = buildFinancialCycles();
        const selectedLastCycle = cycles.at(-1) || allCycles.at(-1);
        if (!selectedLastCycle) {
            return null;
        }

        const nextStart = selectedLastCycle.endExclusive;
        const nextEndExclusive = nextFinancialMonthStart(nextStart);
        const basis = allCycles
            .filter((cycle) => cycle.endExclusive <= lastKnownDate() && cycle.start < nextStart)
            .slice(-3);

        return {
            label: `${nextStart} to ${previousDay(nextEndExclusive)}`,
            salary: averageValues(basis.filter((cycle) => cycle.income > 0), 'income'),
            expenses: averageValues(basis, 'expenses'),
            priority: averageValues(basis, 'priority'),
            nonPriority: averageValues(basis, 'nonPriority'),
            basisCount: basis.length,
        };
    }

    function buildCurrentData() {
        const cycles = selectedCycles();
        const transactions = cycles.flatMap((cycle) => cycle.transactions).map(applyOverrides);
        const salaryTransactions = cycles.flatMap((cycle) => cycle.salaryTransactions);
        const savingsTransfers = cycles.flatMap((cycle) => cycle.savingsTransfers);
        const categories = groupPayments(transactions);
        const essentialPayments = groupEssentialPayments(transactions);

        return {
            period: periodLabel(cycles) || `No 25-to-25 period for ${selectedMonth}`,
            monthly: cycles,
            totals: totalsFromCurrent(cycles, transactions, savingsTransfers),
            salaryTransactions,
            savingsTransfers,
            transactions,
            categories,
            essentialPayments,
            estimate: estimateFollowingMonth(cycles),
            priorityPayments: categories.filter((item) => item.priority === 'priority'),
            nonPriorityPayments: categories.filter((item) => item.priority === 'non-priority'),
        };
    }

    function renderMetrics() {
        const salaryAverage = currentData.salaryTransactions.length
            ? currentData.totals.income / currentData.salaryTransactions.length
            : 0;
        const monthlyAverage = currentData.monthly.length
            ? currentData.totals.expenses / currentData.monthly.length
            : 0;
        const netSavingsDrawn = currentData.totals.savingsOut - currentData.totals.savingsIn;

        setText('periodLabel', currentData.period);
        byId('avgIncome').innerHTML = moneyHtml(salaryAverage);
        setText('salaryRange', `${currentData.salaryTransactions.length} salary deposits confirmed`);
        byId('totalExpenses').innerHTML = moneyHtml(currentData.totals.expenses);
        byId('avgExpenses').innerHTML = `${moneyHtml(monthlyAverage)} 25-to-25 average`;
        byId('priorityTotal').innerHTML = moneyHtml(currentData.totals.priority);
        setText('priorityShare', `${pct(currentData.totals.priority, currentData.totals.expenses)} of expense total`);
        byId('nonPriorityTotal').innerHTML = moneyHtml(currentData.totals.nonPriority);
        setText('nonPriorityShare', `${pct(currentData.totals.nonPriority, currentData.totals.expenses)} of expense total`);
        byId('netSavings').innerHTML = moneyHtml(netSavingsDrawn);
        byId('savingsDetail').innerHTML = `${moneyHtml(currentData.totals.savingsOut)} out, ${moneyHtml(currentData.totals.savingsIn)} in`;
    }

    function resetCharts() {
        charts.forEach((chart) => chart.destroy());
        charts = [];
    }

    function renderCharts() {
        resetCharts();

        const months = currentData.monthly.map((item) => item.month.slice(5));
        const monthlyChart = new ApexCharts(byId('monthlyChart'), {
            chart: { type: 'bar', height: 320, toolbar: { show: false }, fontFamily: 'Inter, Arial, sans-serif' },
            colors: ['#148f63', '#d75452', '#2d6cdf', '#c87d18'],
            series: [
                { name: 'Salary', data: currentData.monthly.map((item) => item.income) },
                { name: 'Expenses', data: currentData.monthly.map((item) => item.expenses) },
                { name: 'Priority', data: currentData.monthly.map((item) => item.priority) },
                { name: 'Non-priority', data: currentData.monthly.map((item) => item.nonPriority) },
            ],
            plotOptions: { bar: { borderRadius: 4, columnWidth: '54%' } },
            dataLabels: { enabled: false },
            xaxis: { categories: months },
            yaxis: { labels: { formatter: (value) => `R${Math.round(value / 1000)}k` } },
            tooltip: { y: { formatter: formatMoney } },
            legend: { position: 'top', horizontalAlign: 'left' },
            grid: { borderColor: '#e2e7ee' },
        });

        const priorityChart = new ApexCharts(byId('priorityChart'), {
            chart: { type: 'donut', height: 280, toolbar: { show: false }, fontFamily: 'Inter, Arial, sans-serif' },
            colors: ['#2d6cdf', '#c87d18'],
            series: [currentData.totals.priority, currentData.totals.nonPriority],
            labels: ['Priority', 'Non-priority'],
            dataLabels: { formatter: (value) => `${Math.round(value)}%` },
            legend: { position: 'bottom' },
            tooltip: { y: { formatter: formatMoney } },
            plotOptions: { pie: { donut: { size: '68%' } } },
        });

        charts = [monthlyChart, priorityChart];
        charts.forEach((chart) => chart.render());
    }

    function groupByMerchant(transactions) {
        const groups = new Map();
        transactions.forEach((item) => {
            const current = groups.get(item.merchant) || {
                name: item.merchant,
                amount: 0,
                count: 0,
                category: item.category,
                priority: item.priority,
            };
            current.amount = roundMoney(current.amount + item.amount);
            current.count += 1;
            groups.set(item.merchant, current);
        });
        return Array.from(groups.values()).sort((a, b) => b.amount - a.amount);
    }

    function insightRows(items, type) {
        if (!items.length) {
            return '<div class="insight-row"><span>No data for this selection.</span></div>';
        }

        return items
            .map((item) => `
                <div class="insight-row">
                    <div>
                        <strong>${escapeHtml(item.name || item.merchant)}</strong>
                        <span>${escapeHtml(item.category)}${item.count ? ` - ${item.count} transaction${item.count === 1 ? '' : 's'}` : ''}</span>
                    </div>
                    <strong>${moneyHtml(item.amount)}</strong>
                </div>
            `)
            .join('');
    }

    function renderSpendInsights() {
        const merchants = groupByMerchant(currentData.transactions);
        const nonPriorityMerchants = merchants.filter((item) => item.priority === 'non-priority').slice(0, 6);
        const repeatedMerchants = merchants.filter((item) => item.count >= 3).slice(0, 6);
        const largestPayments = [...currentData.transactions]
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 6)
            .map((item) => ({
                name: item.merchant,
                category: `${item.date} - ${item.category}`,
                amount: item.amount,
                count: 0,
            }));

        byId('spendInsights').innerHTML = `
            <div class="insight-column">
                <h3>Top flexible merchants</h3>
                ${insightRows(nonPriorityMerchants)}
            </div>
            <div class="insight-column">
                <h3>Repeat spend</h3>
                ${insightRows(repeatedMerchants)}
            </div>
            <div class="insight-column">
                <h3>Largest payments</h3>
                ${insightRows(largestPayments)}
            </div>
        `;
    }

    function allCyclesWithOverrides() {
        return buildFinancialCycles().map((cycle) => {
            const transactions = cycle.transactions.map(applyOverrides);
            return {
                ...cycle,
                transactions,
                ...totalsFromCurrent([cycle], transactions, cycle.savingsTransfers),
            };
        });
    }

    function essentialTotal(transactions) {
        return groupEssentialPayments(transactions).reduce((sum, item) => roundMoney(sum + item.amount), 0);
    }

    function seattleTransactions(transactions) {
        return transactions.filter((item) => /seattle/i.test(`${item.merchant} ${item.description}`));
    }

    function cycleIndex(cycles, start) {
        return cycles.findIndex((cycle) => cycle.start === start);
    }

    function comparisonCycles() {
        const cycles = allCyclesWithOverrides();
        const firstCurrent = currentData.monthly[0];
        if (!firstCurrent) return [];
        const index = cycleIndex(cycles, firstCurrent.start);
        if (index <= 0) return [];
        return cycles.slice(Math.max(0, index - currentData.monthly.length), index);
    }

    function sumCycles(cycles, key) {
        return roundMoney(cycles.reduce((sum, item) => sum + item[key], 0));
    }

    function deltaRow(label, current, previous) {
        const delta = roundMoney(current - previous);
        const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
        return `
            <div class="feature-row">
                <div>
                    <strong>${escapeHtml(label)}</strong>
                    <span>Previous ${moneyHtml(previous)}</span>
                </div>
                <strong class="${direction}">${moneyHtml(delta)}</strong>
            </div>
        `;
    }

    function renderBudgetTargets() {
        const categoryMap = new Map(currentData.categories.map((item) => [item.category, item]));
        const rows = Object.entries(userSettings.budgets)
            .filter(([, budget]) => Number(budget) > 0)
            .map(([category, budget]) => {
                const spent = categoryMap.get(category)?.amount || 0;
                const percent = Math.min(100, Math.round((spent / Math.max(Number(budget), 1)) * 100));
                const over = spent > Number(budget);
                return `
                    <div class="budget-row">
                        <div>
                            <strong>${escapeHtml(category)}</strong>
                            <span>${moneyHtml(spent)} of ${moneyHtml(Number(budget))}</span>
                        </div>
                        <strong class="${over ? 'up' : 'down'}">${over ? 'Over' : `${percent}%`}</strong>
                        <div class="budget-bar"><span style="width: ${percent}%"></span></div>
                    </div>
                `;
            })
            .join('');
        byId('budgetTargets').innerHTML = rows || '<div class="list-row"><span>No budgets configured.</span></div>';
    }

    function selectedCycleWindow() {
        const first = currentData.monthly[0];
        const last = currentData.monthly.at(-1);
        if (!first || !last) return null;
        return {
            start: first.start,
            endExclusive: last.endExclusive,
            endDate: previousDay(last.endExclusive),
        };
    }

    function cycleDaysLeft() {
        const window = selectedCycleWindow();
        if (!window) return 0;
        const today = new Date();
        const start = dateFromIso(window.start);
        const end = dateFromIso(window.endExclusive);
        if (today < start) {
            return Math.max(0, Math.ceil((end - start) / 86400000));
        }
        if (today >= end) return 0;
        return Math.max(0, Math.ceil((end - today) / 86400000));
    }

    function latestMainBalance() {
        const events = [
            ...currentData.transactions,
            ...currentData.salaryTransactions.map((item) => ({ ...item, amount: item.moneyIn })),
        ].filter((item) => typeof item.balance === 'number');

        if (!events.length) {
            return roundMoney(currentData.totals.income + currentData.totals.savingsOut - currentData.totals.expenses - currentData.totals.savingsIn);
        }

        return [...events]
            .sort((a, b) => a.date.localeCompare(b.date))
            .at(-1).balance;
    }

    function categorySpent(category) {
        return currentData.categories.find((item) => item.category === category)?.amount || 0;
    }

    function priorityPeriodKey() {
        return activeManualCycleStart();
    }

    function ensurePriorityChecklistSettings() {
        userSettings.priorityChecklist = userSettings.priorityChecklist || { targets: {}, cycleTargets: {}, cycleSpent: {}, statuses: {} };
        userSettings.priorityChecklist.targets = userSettings.priorityChecklist.targets || {};
        userSettings.priorityChecklist.cycleTargets = userSettings.priorityChecklist.cycleTargets || {};
        userSettings.priorityChecklist.cycleSpent = userSettings.priorityChecklist.cycleSpent || {};
        userSettings.priorityChecklist.statuses = userSettings.priorityChecklist.statuses || {};
        return userSettings.priorityChecklist;
    }

    function priorityAmountFrom(definition, transactions, savingsTransfers) {
        if (definition.savings) {
            return roundMoney(savingsTransfers
                .filter((item) => item.direction === 'To savings')
                .reduce((sum, item) => sum + item.moneyOut + item.fees, 0));
        }
        if (definition.category) {
            return roundMoney(transactions
                .filter((item) => item.category === definition.category)
                .reduce((sum, item) => sum + item.amount, 0));
        }
        if (definition.categories) {
            return roundMoney(transactions
                .filter((item) => definition.categories.includes(item.category))
                .reduce((sum, item) => sum + item.amount, 0));
        }
        if (definition.matcher) {
            return roundMoney(transactions
                .filter((item) => definition.matcher(item))
                .reduce((sum, item) => sum + item.amount, 0));
        }
        return 0;
    }

    function priorityAverageTarget(definition) {
        const values = completedFinancialCycles()
            .map((cycle) => priorityAmountFrom(
                definition,
                cycle.transactions.map(applyOverrides),
                cycle.savingsTransfers,
            ))
            .filter((amount) => amount > 0);
        if (!values.length) return Number(definition.fallback || 0);
        return roundMoney(values.reduce((sum, amount) => sum + amount, 0) / values.length);
    }

    function priorityPlanStatus() {
        const checklist = ensurePriorityChecklistSettings();
        const periodKey = priorityPeriodKey();
        const periodStatuses = checklist.statuses[periodKey] || {};
        const periodTargets = checklist.cycleTargets[periodKey] || {};
        const periodSpent = checklist.cycleSpent[periodKey] || {};
        return priorityItemDefinitions.map((item) => {
            const averageTarget = priorityAverageTarget(item);
            const target = roundMoney(Number(periodTargets[item.key] || checklist.targets[item.key] || averageTarget || item.fallback || 0));
            const actual = roundMoney(Number(periodSpent[item.key] || 0));
            const storedStatus = periodStatuses[item.key];
            const overspent = actual > target && target > 0;
            const amountLeft = Math.max(0, roundMoney(target - actual));
            const overAmount = overspent ? roundMoney(actual - target) : 0;
            const inferredStatus = overspent ? 'unpaid' : actual > 0 && amountLeft <= 0 ? 'paid' : 'pending';
            const manualStatus = ['paid', 'unpaid', 'pending'].includes(storedStatus) ? storedStatus : '';
            const status = manualStatus || inferredStatus;
            const paid = status === 'paid';
            const remaining = paid ? 0 : amountLeft;

            return {
                ...item,
                actual: roundMoney(actual),
                target,
                averageTarget,
                amountLeft,
                overAmount,
                overspent,
                underBudget: !overspent && amountLeft > 0,
                remaining,
                paid,
                status,
                manualStatus,
                hasKnownTarget: target > 0,
            };
        });
    }

    function cockpitBudgetCategories() {
        return [
            { label: 'Petrol', category: 'Fuel/transport' },
            { label: 'Groceries', category: 'Groceries' },
            { label: 'Leisure', category: 'Leisure' },
            { label: 'Subscriptions', category: 'Subscriptions/software' },
        ];
    }

    function renderPriorityChecklist(statuses) {
        const target = byId('priorityChecklist');
        if (!target) return;
        const rows = statuses.map((item, index) => {
            const detail = item.hasKnownTarget
                ? `${moneyHtml(item.actual)} of ${moneyHtml(item.target)}`
                : item.actual
                    ? `${moneyHtml(item.actual)} paid this cycle`
                    : 'Not seen in this cycle';
            const state = item.status === 'paid' ? 'Paid' : item.status === 'unpaid' ? 'Unpaid' : 'Pending';
            const stateClass = item.status;
            return `
                <div class="checklist-row ${stateClass}">
                    <div>
                        <strong>${index + 1}. ${escapeHtml(item.label)}</strong>
                        <span>${escapeHtml(item.detail || 'Monthly priority')} - ${detail}</span>
                    </div>
                    <strong>${item.remaining ? moneyHtml(item.remaining) : state}</strong>
                </div>
            `;
        }).join('');
        const plannedTotal = roundMoney(statuses.reduce((sum, item) => sum + item.target, 0));
        const paidTotal = roundMoney(statuses.reduce((sum, item) => sum + item.actual, 0));
        const remainingTotal = roundMoney(statuses.reduce((sum, item) => sum + item.remaining, 0));

        target.innerHTML = `${rows}
            <div class="checklist-total">
                <div>
                    <strong>Monthly priority total</strong>
                    <span>${moneyHtml(paidTotal)} paid or spent of ${moneyHtml(plannedTotal)}</span>
                </div>
                <strong>${moneyHtml(remainingTotal)} left</strong>
            </div>`;
    }

    function renderPriorityCards(statuses) {
        statuses.forEach((item) => {
            const card = document.querySelector(`[data-priority-key="${item.key}"]`);
            if (!card) return;
            const amountNode = card.querySelector('.priority-amount');
            const statusLabel = item.overspent
                ? 'Over spent'
                : item.amountLeft > 0
                    ? 'Under budget'
                    : item.status === 'paid'
                        ? 'Paid'
                        : item.status === 'unpaid'
                            ? 'Unpaid'
                            : 'Pending';
            const budgetState = item.overspent ? 'over' : item.amountLeft > 0 ? 'under' : item.status;
            const amountDetail = item.overspent
                ? `${formatMoney(item.overAmount)} over`
                : `${formatMoney(item.amountLeft)} left`;
            card.classList.remove('status-paid', 'status-unpaid', 'status-pending', 'status-over', 'status-under', 'paid', 'unpaid', 'pending');
            card.classList.add(`status-${budgetState}`);
            card.classList.add(item.status);
            card.title = `${item.label}: ${formatMoney(item.actual)} spent, max ${formatMoney(item.target)}, ${amountDetail}`;
            if (amountNode) {
                amountNode.innerHTML = `
                    <span>${formatMoney(item.actual)}</span>
                    <small>${amountDetail}</small>
                `;
            }

            let statusNode = card.querySelector('.priority-status-chip');
            if (!statusNode) {
                statusNode = document.createElement('span');
                statusNode.className = 'priority-status-chip';
                card.appendChild(statusNode);
            }
            statusNode.className = `priority-status-chip ${item.overspent ? 'unpaid' : item.status}`;
            statusNode.textContent = statusLabel;
        });
    }

    function renderPriorityChecklistEditor(statuses) {
        const editor = byId('priorityChecklistEditor');
        if (!editor || editor.hidden) return;
        const period = manualCycleLabelFor(activeManualCycleStart());
        editor.innerHTML = `
            <div class="priority-editor-head">
                <div>
                    <strong>Edit priority checklist</strong>
                    <span>${escapeHtml(period)}. Amounts are monthly planning targets. Status is saved for this period.</span>
                </div>
                <button type="button" class="tf-button style-4 f12-bold" id="cancelPriorityEdit">Cancel</button>
            </div>
            <div class="priority-editor-grid">
                ${statuses.map((item) => `
                    <label class="priority-editor-row">
                        <span class="priority-editor-copy">
                            <strong>${escapeHtml(item.label)}</strong>
                            <small>${escapeHtml(item.detail || 'Monthly priority')} - ${item.overspent ? `${formatMoney(item.overAmount)} over max` : `${formatMoney(item.amountLeft)} left`}</small>
                        </span>
                        <span class="priority-input-field">
                            <small>Spent Amount</small>
                            <input type="number" min="0" step="0.01" value="${item.actual || ''}" data-priority-spent="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)} spent amount" placeholder="0.00">
                        </span>
                        <span class="priority-input-field">
                            <small>Max Spend Amount</small>
                            <input type="number" min="0" step="0.01" value="${item.target}" data-priority-target="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)} max spend amount" placeholder="0.00">
                        </span>
                        <span class="priority-input-field">
                            <small>Status</small>
                            <select data-priority-status="${escapeHtml(item.key)}" aria-label="${escapeHtml(item.label)} status">
                                <option value="pending" ${item.status === 'pending' ? 'selected' : ''}>PENDING</option>
                                <option value="paid" ${item.status === 'paid' ? 'selected' : ''}>PAID</option>
                                <option value="unpaid" ${item.status === 'unpaid' ? 'selected' : ''}>UNPAID</option>
                            </select>
                        </span>
                    </label>
                `).join('')}
            </div>
            <div class="priority-editor-actions">
                <button type="button" class="tf-button style-1 f12-bold" id="savePriorityEdit">Save checklist</button>
                <button type="button" class="tf-button style-4 f12-bold" id="resetPriorityEdit">Reset amounts to averages</button>
            </div>
        `;
    }

    function renderCockpitBudgetMeters() {
        const rows = cockpitBudgetCategories().map((item) => {
            const budget = Number(userSettings.budgets[item.category] || 0);
            const spent = categorySpent(item.category);
            const remaining = roundMoney(budget - spent);
            const percent = Math.min(100, Math.round((spent / Math.max(budget, 1)) * 100));
            const over = remaining < 0;
            return `
                <div class="budget-meter ${over ? 'over' : ''}">
                    <div class="budget-meter-top">
                        <div>
                            <strong>${escapeHtml(item.label)}</strong>
                            <span>${moneyHtml(spent)} of ${moneyHtml(budget)}</span>
                        </div>
                        <strong>${over ? `${moneyHtml(Math.abs(remaining))} over` : `${moneyHtml(remaining)} left`}</strong>
                    </div>
                    <div class="budget-bar"><span style="width: ${percent}%"></span></div>
                </div>
            `;
        }).join('');

        byId('cockpitBudgetMeters').innerHTML = rows;
    }

    function renderActionAlerts(statuses) {
        const alerts = [];
        const manual = manualOverviewData();
        const overBudgetItems = statuses.filter((item) => item.overspent);
        const inactive = currentData.transactions.filter(isInactiveJuneCost);
        const unapprovedGoogle = currentData.transactions
            .filter((item) => /google/i.test(`${item.merchant} ${item.description}`))
            .filter((item) => !allowedGoogleRules.some((rule) => rule.matcher(item)));
        const overspent = cockpitBudgetCategories()
            .map((item) => ({ ...item, spent: categorySpent(item.category), budget: Number(userSettings.budgets[item.category] || 0) }))
            .filter((item) => item.budget > 0 && item.spent > item.budget);
        const unpaidKnown = statuses.filter((item) => item.remaining > 0);
        const netSavingsDrawn = roundMoney(currentData.totals.savingsOut - currentData.totals.savingsIn);

        if (!Number(manual.salary || manual.availableUntilSalary || 0)) alerts.push({ label: 'Salary not set', detail: 'Add your salary in the current cycle setup', type: 'warn' });
        if (overBudgetItems.length) alerts.push({ label: 'Priority overspend', detail: overBudgetItems.map((item) => item.label).join(', '), type: 'danger' });
        if (unpaidKnown.length) alerts.push({ label: 'Money still reserved', detail: `${unpaidKnown.length} priority items still have remaining target`, type: 'warn' });
        if (inactive.length) alerts.push({ label: 'Inactive costs appeared', detail: `${inactive.length} inactive cost entries`, type: 'danger' });
        if (unapprovedGoogle.length) alerts.push({ label: 'Unapproved Google charge', detail: `${unapprovedGoogle.length} Google payment needs review`, type: 'danger' });
        if (overspent.length) alerts.push({ label: 'Budget overrun', detail: overspent.map((item) => item.label).join(', '), type: 'danger' });
        if (netSavingsDrawn > 0) alerts.push({ label: 'GoalSave drawdown', detail: `${moneyHtml(netSavingsDrawn)} net drawn from savings`, type: 'warn' });

        byId('actionAlerts').innerHTML = alerts.length
            ? alerts.map((item) => `
                <div class="alert-row ${item.type}">
                    <div>
                        <strong>${escapeHtml(item.label)}</strong>
                        <span>${item.detail}</span>
                    </div>
                </div>
            `).join('')
            : '<div class="alert-row good"><div><strong>All clear</strong><span>No inactive costs or overspends detected for this view.</span></div></div>';
    }

    function renderCockpit() {
        const statuses = priorityPlanStatus();
        const manual = manualOverviewData();
        const salary = roundMoney(Number(manual.salary || manual.availableUntilSalary || 0));
        const expensesPaid = roundMoney(statuses
            .filter((item) => item.key !== 'savings')
            .reduce((sum, item) => sum + item.actual, 0));
        const goalSave = roundMoney(statuses.find((item) => item.key === 'savings')?.actual || 0);
        const totalLeftOver = roundMoney(salary - expensesPaid - goalSave);

        setText('salaryCardLabel', `Salary for ${monthNames.find(([value]) => value === activeManualCycleStart().slice(5, 7))?.[1] || activeManualCycleStart().slice(5, 7)} ${activeManualCycleStart().slice(0, 4)}`);
        byId('availableNow').innerHTML = moneyHtml(salary);
        byId('availableDetail').innerHTML = manualCycleLabelFor(activeManualCycleStart());
        byId('safeDailySpend').innerHTML = moneyHtml(expensesPaid);
        setText('safeDailyDetail', 'Total of paid checklist items');
        byId('priorityRemaining').innerHTML = moneyHtml(goalSave);
        setText('priorityRemainingDetail', 'Savings amount in checklist');
        byId('goalSaveProgress').innerHTML = moneyHtml(totalLeftOver);
        byId('goalSaveDetail').innerHTML = `${moneyHtml(salary)} salary - ${moneyHtml(expensesPaid)} paid - ${moneyHtml(goalSave)} GoalSave`;

        renderPriorityCards(statuses);
        renderCockpitBudgetMeters();
        renderActionAlerts(statuses);
    }

    function flexibleBudgetCategories() {
        return ['Groceries', 'Leisure', 'Dining & coffee', 'Shopping & online', 'Subscriptions/software', 'Fuel/transport', 'Mobile/data'];
    }

    function plannedPriorityAmount(item) {
        if (typeof item.planned === 'number') return item.planned;
        if (item.category) return Number(userSettings.budgets[item.category] || 0);
        if (!item.matcher) return 0;
        return roundMoney(currentData.transactions
            .filter((transaction) => item.matcher(transaction))
            .reduce((sum, transaction) => sum + transaction.amount, 0));
    }

    function renderJunePriorityPlan() {
        const priorityRows = junePriorityPlan
            .map((item, index) => {
                const amount = plannedPriorityAmount(item);
                const detail = item.detail || 'Priority June cost';
                return `
                    <div class="feature-row">
                        <div>
                            <strong>${index + 1}. ${escapeHtml(item.label)}</strong>
                            <span>${escapeHtml(detail)}</span>
                        </div>
                        <strong>${amount ? moneyHtml(amount) : 'Track'}</strong>
                    </div>
                `;
            })
            .join('');
        const inactiveRows = juneInactiveCosts
            .map((label) => `
                <div class="feature-row flagged">
                    <span>${escapeHtml(label)}</span>
                    <strong>Inactive</strong>
                </div>
            `)
            .join('');

        return `
            <div class="feature-subheading">June priority order</div>
            ${priorityRows}
            <div class="feature-subheading">No longer active for June</div>
            ${inactiveRows}
        `;
    }

    function historicalBudgetBasis() {
        const cycles = allCyclesWithOverrides()
            .filter((cycle) => cycle.endExclusive <= lastKnownDate() && cycle.income > 0)
            .slice(-6);
        const totals = {};
        flexibleBudgetCategories().forEach((category) => {
            totals[category] = 0;
        });

        cycles.forEach((cycle) => {
            groupPayments(cycle.transactions).forEach((group) => {
                if (Object.prototype.hasOwnProperty.call(totals, group.category)) {
                    totals[group.category] = roundMoney(totals[group.category] + group.amount);
                }
            });
        });

        const averages = {};
        Object.entries(totals).forEach(([category, total]) => {
            averages[category] = cycles.length ? roundMoney(total / cycles.length) : 0;
        });

        const averageIncome = averageValues(cycles.filter((cycle) => cycle.income > 0), 'income');
        const averageEssential = cycles.length
            ? roundMoney(cycles.reduce((sum, cycle) => sum + essentialTotal(cycle.transactions), 0) / cycles.length)
            : 0;
        const averagePriorityOther = cycles.length
            ? roundMoney(cycles.reduce((sum, cycle) => {
                const essential = essentialTotal(cycle.transactions);
                return sum + Math.max(0, cycle.priority - essential);
            }, 0) / cycles.length)
            : 0;

        return { cycles, averages, averageIncome, averageEssential, averagePriorityOther };
    }

    function renderBudgetPlanner() {
        const targetInput = byId('goalSaveTarget');
        targetInput.value = Number(userSettings.goalSaveTarget || 0);

        const basis = historicalBudgetBasis();
        const historicalFlexibleTotal = roundMoney(Object.values(basis.averages).reduce((sum, value) => sum + value, 0));
        const availableAfterEssentials = roundMoney(
            basis.averageIncome - basis.averageEssential - basis.averagePriorityOther - Number(userSettings.goalSaveTarget || 0),
        );
        const scale = historicalFlexibleTotal > 0
            ? Math.min(1, Math.max(0, availableAfterEssentials / historicalFlexibleTotal))
            : 0;

        const rows = flexibleBudgetCategories()
            .map((category) => {
                const historical = basis.averages[category] || 0;
                const hasFixedTarget = Object.prototype.hasOwnProperty.call(fixedJuneBudgetTargets, category);
                const adjusted = hasFixedTarget ? fixedJuneBudgetTargets[category] : roundMoney(historical * scale);
                userSettings.budgets[category] = adjusted;
                const detail = hasFixedTarget
                    ? `June target set at ${moneyHtml(adjusted)}`
                    : `Historical ${moneyHtml(historical)} adjusted by ${Math.round(scale * 100)}%`;
                return `
                    <div class="budget-row">
                        <div>
                            <strong>${escapeHtml(category)}</strong>
                            <span>${detail}</span>
                        </div>
                        <strong>${moneyHtml(adjusted)}</strong>
                        <div class="budget-bar"><span style="width: ${hasFixedTarget ? 100 : Math.round(scale * 100)}%"></span></div>
                    </div>
                `;
            })
            .join('');

        byId('budgetPlanner').innerHTML = `
            ${renderJunePriorityPlan()}
            <div class="feature-row">
                <span>Income after essentials, other priority, and GoalSave</span>
                <strong>${moneyHtml(availableAfterEssentials)}</strong>
            </div>
            <div class="feature-row">
                <span>Historical flexible baseline</span>
                <strong>${moneyHtml(historicalFlexibleTotal)}</strong>
            </div>
            ${rows}
        `;
        saveSettings();
    }

    function isInactiveJuneCost(item) {
        const text = `${item.merchant} ${item.description}`;
        return /Strava|Patreon|Google Ads|Seattle|Coffee|Vehicle Finance/i.test(text);
    }

    function renderSubscriptionDetector() {
        const cycles = allCyclesWithOverrides();
        const groups = new Map();
        cycles.forEach((cycle) => {
            cycle.transactions
                .filter((item) => !isInactiveJuneCost(item))
                .filter((item) => item.category === 'Subscriptions/software' || /GOOGLE|OPENAI|DISCORD|Steam|PLAYTOMIC|OPUS|Netflix|Spotify|Apple|Adobe|Canva/i.test(item.description))
                .forEach((item) => {
                    const current = groups.get(item.merchant) || { merchant: item.merchant, cycles: new Map(), count: 0 };
                    current.cycles.set(cycle.start, roundMoney((current.cycles.get(cycle.start) || 0) + item.amount));
                    current.count += 1;
                    groups.set(item.merchant, current);
                });
        });

        const rows = Array.from(groups.values())
            .filter((item) => item.cycles.size >= 2 || item.count >= 3)
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
            .map((item) => {
                const entries = Array.from(item.cycles.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                const current = entries.at(-1)?.[1] || 0;
                const previous = entries.at(-2)?.[1] || 0;
                const changed = previous && current !== previous;
                return `
                    <div class="feature-row">
                        <div>
                            <strong>${escapeHtml(item.merchant)}</strong>
                            <span>${item.cycles.size} periods - ${changed ? `changed by ${moneyHtml(roundMoney(current - previous))}` : 'stable/repeated'}</span>
                        </div>
                        <strong>${moneyHtml(current)}</strong>
                    </div>
                `;
            })
            .join('');
        const flaggedGoogleRows = currentData.transactions
            .filter((item) => /google/i.test(`${item.merchant} ${item.description}`))
            .filter((item) => !allowedGoogleRules.some((rule) => rule.matcher(item)))
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((item) => `
                <div class="feature-row flagged">
                    <div>
                        <strong>${escapeHtml(item.merchant)}</strong>
                        <span>${escapeHtml(item.date)} - not on approved Google list</span>
                    </div>
                    <strong>${moneyHtml(item.amount)}</strong>
                </div>
            `)
            .join('');
        const googleNote = `
            <div class="feature-note">
                <strong>Google payment rule</strong>
                <span>Only these Google payments are approved for June: Google One ${moneyHtml(34.99)} and YouTube Premium ${moneyHtml(81.99)}. Strava and Google Ads are inactive.</span>
            </div>
        `;
        const flaggedSection = flaggedGoogleRows
            ? `<div class="feature-subheading">Flagged Google charges</div>${flaggedGoogleRows}`
            : '<div class="feature-row"><span>No unapproved Google charges in this selection.</span></div>';
        byId('subscriptionDetector').innerHTML = `${googleNote}${flaggedSection}${rows || '<div class="list-row"><span>No recurring subscriptions detected.</span></div>'}`;
    }

    function renderCoffeeTracker() {
        const tracker = byId('coffeeTracker');
        if (!tracker) return;
        const currentRows = seattleTransactions(currentData.transactions);
        const previousRows = comparisonCycles().flatMap((cycle) => seattleTransactions(cycle.transactions));
        const currentTotal = roundMoney(currentRows.reduce((sum, item) => sum + item.amount, 0));
        const previousAverage = previousRows.length && comparisonCycles().length
            ? roundMoney(previousRows.reduce((sum, item) => sum + item.amount, 0) / comparisonCycles().length)
            : 0;
        const averageVisit = currentRows.length ? roundMoney(currentTotal / currentRows.length) : 0;
        tracker.innerHTML = `
            <div class="feature-row flagged"><span>June status</span><strong>Inactive</strong></div>
            <div class="feature-row"><span>Visits</span><strong>${currentRows.length}</strong></div>
            <div class="feature-row"><span>Total</span><strong>${moneyHtml(currentTotal)}</strong></div>
            <div class="feature-row"><span>Average visit</span><strong>${moneyHtml(averageVisit)}</strong></div>
            <div class="feature-row"><span>Vs previous average</span><strong>${moneyHtml(roundMoney(currentTotal - previousAverage))}</strong></div>
        `;
    }

    function renderCashflowCalendar() {
        const events = [];
        currentData.salaryTransactions.forEach((item) => events.push({ date: item.date, label: 'Salary', detail: item.description, amount: item.moneyIn, type: 'income' }));
        currentData.savingsTransfers.forEach((item) => events.push({ date: item.date, label: item.direction, detail: item.description, amount: item.moneyIn || item.moneyOut, type: 'savings' }));
        currentData.essentialPayments.flatMap((item) => item.transactions).forEach((item) => events.push({ date: item.date, label: 'Essential', detail: item.merchant, amount: item.amount, type: 'priority' }));
        currentData.transactions.filter((item) => item.amount >= 500).forEach((item) => events.push({ date: item.date, label: 'Large payment', detail: item.merchant, amount: item.amount, type: item.priority }));

        const rows = events
            .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
            .slice(0, 40)
            .map((item) => `
                <div class="calendar-row ${item.type}">
                    <span>${item.date}</span>
                    <div>
                        <strong>${escapeHtml(item.label)}</strong>
                        <small>${escapeHtml(item.detail)}</small>
                    </div>
                    <strong>${moneyHtml(item.amount)}</strong>
                </div>
            `)
            .join('');
        byId('cashflowCalendar').innerHTML = rows || '<div class="list-row"><span>No cashflow events for this selection.</span></div>';
    }

    function renderMonthComparison() {
        const previous = comparisonCycles();
        if (!previous.length) {
            byId('monthComparison').innerHTML = '<div class="list-row"><span>No previous period to compare.</span></div>';
            return;
        }
        const currentSeattle = roundMoney(seattleTransactions(currentData.transactions).reduce((sum, item) => sum + item.amount, 0));
        const previousTransactions = previous.flatMap((cycle) => cycle.transactions);
        const previousSeattle = roundMoney(seattleTransactions(previousTransactions).reduce((sum, item) => sum + item.amount, 0));
        byId('monthComparison').innerHTML = [
            deltaRow('Salary', currentData.totals.income, sumCycles(previous, 'income')),
            deltaRow('Expenses', currentData.totals.expenses, sumCycles(previous, 'expenses')),
            deltaRow('Priority', currentData.totals.priority, sumCycles(previous, 'priority')),
            deltaRow('Non-priority', currentData.totals.nonPriority, sumCycles(previous, 'nonPriority')),
            deltaRow('Essential payments', essentialTotal(currentData.transactions), essentialTotal(previousTransactions)),
            deltaRow('Seattle', currentSeattle, previousSeattle),
        ].join('');
    }

    function renderSavingsPressure() {
        const netDrawn = roundMoney(currentData.totals.savingsOut - currentData.totals.savingsIn);
        const incomeGap = roundMoney(currentData.totals.expenses - currentData.totals.income);
        const status = netDrawn > 0 || incomeGap > 0 ? 'Pressure' : 'Stable';
        byId('savingsPressure').innerHTML = `
            <div class="feature-row"><span>Status</span><strong class="${status === 'Pressure' ? 'up' : 'down'}">${status}</strong></div>
            <div class="feature-row"><span>Net GoalSave drawn</span><strong>${moneyHtml(netDrawn)}</strong></div>
            <div class="feature-row"><span>Expenses over salary</span><strong>${moneyHtml(incomeGap)}</strong></div>
            <div class="feature-row"><span>GoalSave out</span><strong>${moneyHtml(currentData.totals.savingsOut)}</strong></div>
            <div class="feature-row"><span>GoalSave in</span><strong>${moneyHtml(currentData.totals.savingsIn)}</strong></div>
        `;
    }

    function renderMerchantEditorSummary() {
        const merchantCount = Object.keys(userSettings.merchantOverrides).length;
        const categoryCount = Object.keys(userSettings.categoryOverrides).length;
        byId('merchantEditorSummary').innerHTML = `
            <div class="feature-row"><span>Merchant rename rules</span><strong>${merchantCount}</strong></div>
            <div class="feature-row"><span>Transaction category overrides</span><strong>${categoryCount}</strong></div>
            <div class="list-row"><span>Overrides are saved in this browser and applied before dashboard totals are grouped.</span></div>
        `;
    }

    function renderSalaryList() {
        const total = roundMoney(currentData.salaryTransactions.reduce((sum, item) => sum + item.moneyIn, 0));
        const rows = currentData.salaryTransactions.length
            ? currentData.salaryTransactions
            .map((item) => `
                <div class="list-row">
                    <span>${item.date}</span>
                    <strong>${moneyHtml(item.moneyIn)}</strong>
                    <span>${escapeHtml(item.description)}</span>
                </div>
            `)
            .join('')
            : '<div class="list-row"><span>No salary deposit found for this selection.</span></div>';
        byId('salaryList').innerHTML = `${rows}
            <div class="section-total">
                <span>Total</span>
                <strong>${moneyHtml(total)}</strong>
            </div>`;
    }

    function renderPaymentList(id, payments) {
        const total = roundMoney(payments.reduce((sum, item) => sum + item.amount, 0));
        const rows = payments.length
            ? payments
            .map((item) => `
                <details class="payment-row">
                    <summary>
                        <div>
                            <strong>${escapeHtml(item.category)}</strong>
                            <span>${item.count} transactions</span>
                        </div>
                        <strong>${moneyHtml(item.amount)}</strong>
                    </summary>
                    <div class="payment-breakdown">
                        ${item.transactions
                            .map((transaction) => `
                                <div class="breakdown-row">
                                    <div>
                                        <span>${transaction.date}</span>
                                        <strong>${escapeHtml(transaction.merchant)}</strong>
                                        <small>${escapeHtml(transaction.description)}</small>
                                    </div>
                                    <strong>${moneyHtml(transaction.amount)}</strong>
                                </div>
                            `)
                            .join('')}
                    </div>
                </details>
            `)
            .join('')
            : '<div class="list-row"><span>No transactions found for this selection.</span></div>';
        byId(id).innerHTML = `${rows}
            <div class="section-total">
                <span>Total</span>
                <strong>${moneyHtml(total)}</strong>
            </div>`;
    }

    function renderEstimate() {
        const estimate = currentData.estimate;
        if (!estimate) {
            byId('estimatePanel').innerHTML = '<div class="list-row"><span>No estimate available.</span></div>';
            return;
        }

        const projectedBalance = roundMoney(estimate.salary - estimate.expenses);
        byId('estimatePanel').innerHTML = `
            <div class="estimate-row">
                <span>Next period</span>
                <strong>${estimate.label}</strong>
                <small>Based on ${estimate.basisCount} completed 25-to-25 period${estimate.basisCount === 1 ? '' : 's'}.</small>
            </div>
            <div class="estimate-row">
                <span>Estimated salary</span>
                <strong>${moneyHtml(estimate.salary)}</strong>
            </div>
            <div class="estimate-row">
                <span>Estimated expenses</span>
                <strong>${moneyHtml(estimate.expenses)}</strong>
            </div>
            <div class="estimate-row">
                <span>Priority estimate</span>
                <strong>${moneyHtml(estimate.priority)}</strong>
            </div>
            <div class="estimate-row">
                <span>Non-priority estimate</span>
                <strong>${moneyHtml(estimate.nonPriority)}</strong>
            </div>
            <div class="section-total">
                <span>Estimated balance</span>
                <strong>${moneyHtml(projectedBalance)}</strong>
            </div>
        `;
    }

    function filteredTransactions() {
        return currentData.transactions.filter((item) => {
            const matchesFilter = activeFilter === 'all' || item.priority === activeFilter;
            const haystack = `${item.merchant} ${item.category} ${item.description}`.toLowerCase();
            return matchesFilter && haystack.includes(searchTerm);
        });
    }

    function renderTransactions() {
        const rows = filteredTransactions();
        byId('transactionRows').innerHTML = rows.length
            ? rows
            .slice(0, 120)
            .map((item) => `
                <tr>
                    <td>${item.date}</td>
                    <td><strong>${escapeHtml(item.merchant)}</strong><br><span>${escapeHtml(item.description)}</span></td>
                    <td>${escapeHtml(item.category)}</td>
                    <td><span class="type-pill ${item.priority}">${item.priority}</span></td>
                    <td class="amount-cell"><strong>${moneyHtml(item.amount)}</strong></td>
                </tr>
            `)
            .join('')
            : '<tr><td colspan="5">No transactions found for this selection.</td></tr>';
    }

    function openSettings(mode) {
        byId('settingsPanel').hidden = false;
        if (mode === 'budgets') {
            byId('settingsTitle').textContent = 'Budget targets';
            renderBudgetSettings();
        } else {
            byId('settingsTitle').textContent = 'Merchant names and categories';
            renderOverrideSettings();
        }
        byId('settingsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderBudgetSettings() {
        const categories = Array.from(new Set([...categoryOptions, ...Object.keys(userSettings.budgets)])).sort();
        byId('settingsContent').innerHTML = `
            <div class="settings-grid">
                ${categories.map((category) => `
                    <label class="settings-field">
                        <span>${escapeHtml(category)}</span>
                        <input type="number" min="0" step="50" data-budget-category="${escapeHtml(category)}" value="${Number(userSettings.budgets[category] || 0)}">
                    </label>
                `).join('')}
            </div>
        `;
        byId('settingsContent').querySelectorAll('[data-budget-category]').forEach((input) => {
            input.addEventListener('change', () => {
                userSettings.budgets[input.dataset.budgetCategory] = Number(input.value || 0);
                saveSettings();
                renderDashboard();
                renderBudgetSettings();
            });
        });
    }

    function renderOverrideSettings() {
        const merchants = Array.from(
            currentData.transactions.reduce((groups, item) => {
                const original = item.originalMerchant || item.merchant;
                const current = groups.get(original) || { name: original, amount: 0, count: 0 };
                current.amount = roundMoney(current.amount + item.amount);
                current.count += 1;
                groups.set(original, current);
                return groups;
            }, new Map()).values(),
        ).sort((a, b) => b.amount - a.amount).slice(0, 16);
        const transactions = currentData.transactions.slice(0, 30);
        byId('settingsContent').innerHTML = `
            <div class="settings-block">
                <h3>Rename merchants</h3>
                <div class="settings-grid">
                    ${merchants.map((merchant) => `
                        <label class="settings-field">
                            <span>${escapeHtml(merchant.name)}</span>
                            <input type="text" data-merchant-original="${escapeHtml(merchant.name)}" value="${escapeHtml(userSettings.merchantOverrides[merchant.name] || '')}" placeholder="Display name">
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="settings-block">
                <h3>Override transaction categories</h3>
                <div class="override-list">
                    ${transactions.map((transaction) => {
                        const key = transactionKey(transaction);
                        return `
                            <label class="override-row">
                                <span>${escapeHtml(transaction.date)} - ${escapeHtml(transaction.merchant)}</span>
                                <small>${escapeHtml(transaction.description)}</small>
                                <select data-category-key="${escapeHtml(key)}">
                                    ${categoryOptions.map((category) => `
                                        <option value="${escapeHtml(category)}" ${category === transaction.category ? 'selected' : ''}>${escapeHtml(category)}</option>
                                    `).join('')}
                                </select>
                            </label>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
        byId('settingsContent').querySelectorAll('[data-merchant-original]').forEach((input) => {
            input.addEventListener('change', () => {
                const original = input.dataset.merchantOriginal;
                if (input.value.trim()) userSettings.merchantOverrides[original] = input.value.trim();
                else delete userSettings.merchantOverrides[original];
                saveSettings();
                renderDashboard();
                renderOverrideSettings();
            });
        });
        byId('settingsContent').querySelectorAll('[data-category-key]').forEach((select) => {
            select.addEventListener('change', () => {
                userSettings.categoryOverrides[select.dataset.categoryKey] = select.value;
                saveSettings();
                renderDashboard();
                renderOverrideSettings();
            });
        });
    }

    function renderDashboard() {
        currentData = buildCurrentData();
        renderMetrics();
        renderCharts();
        renderSpendInsights();
        renderEstimate();
        renderBudgetPlanner();
        renderCockpit();
        renderBudgetTargets();
        renderSubscriptionDetector();
        renderCoffeeTracker();
        renderCashflowCalendar();
        renderMonthComparison();
        renderSavingsPressure();
        renderMerchantEditorSummary();
        renderSalaryList();
        renderPaymentList('essentialPayments', currentData.essentialPayments);
        renderPaymentList('priorityPayments', currentData.priorityPayments);
        renderPaymentList('nonPriorityPayments', currentData.nonPriorityPayments);
        renderTransactions();
    }

    function savePriorityChecklistEditor() {
        const editor = byId('priorityChecklistEditor');
        if (!editor) return;
        const checklist = ensurePriorityChecklistSettings();
        const periodKey = priorityPeriodKey();
        checklist.statuses[periodKey] = checklist.statuses[periodKey] || {};
        checklist.cycleTargets[periodKey] = checklist.cycleTargets[periodKey] || {};
        checklist.cycleSpent[periodKey] = checklist.cycleSpent[periodKey] || {};

        editor.querySelectorAll('[data-priority-target]').forEach((input) => {
            const key = input.dataset.priorityTarget;
            const amount = Number(input.value || 0);
            if (amount > 0) {
                checklist.targets[key] = roundMoney(amount);
                checklist.cycleTargets[periodKey][key] = roundMoney(amount);
            } else {
                delete checklist.targets[key];
                delete checklist.cycleTargets[periodKey][key];
            }
        });
        editor.querySelectorAll('[data-priority-spent]').forEach((input) => {
            const key = input.dataset.prioritySpent;
            const amount = Number(input.value || 0);
            if (amount > 0) checklist.cycleSpent[periodKey][key] = roundMoney(amount);
            else delete checklist.cycleSpent[periodKey][key];
        });
        editor.querySelectorAll('[data-priority-status]').forEach((select) => {
            checklist.statuses[periodKey][select.dataset.priorityStatus] = select.value;
        });

        saveSettings();
        editor.hidden = true;
        renderDashboard();
        showLocalToast('success', 'Checklist saved', 'Priority amounts and statuses were updated for this view.');
    }

    function resetPriorityChecklistTargets() {
        const checklist = ensurePriorityChecklistSettings();
        const periodKey = priorityPeriodKey();
        checklist.targets = {};
        delete checklist.cycleTargets[periodKey];
        delete checklist.cycleSpent[periodKey];
        saveSettings();
        renderDashboard();
        showLocalToast('basic', 'Checklist reset', 'Priority amounts are using statement averages again.');
    }

    function cycleStartFromManualControls() {
        const month = byId('manualCycleMonth')?.value || activeManualCycleStart().slice(5, 7);
        const year = byId('manualCycleYear')?.value || activeManualCycleStart().slice(0, 4);
        return `${year}-${month}-25`;
    }

    function populateManualCycleControls() {
        const monthSelect = byId('manualCycleMonth');
        const yearSelect = byId('manualCycleYear');
        if (!monthSelect || !yearSelect) return;

        const currentCycle = currentManualCycleStart();
        const currentYear = Number(currentCycle.slice(0, 4));
        const maxDataYear = allKnownDates().reduce((max, item) => Math.max(max, Number(item.slice(0, 4))), currentYear);
        const maxYear = Math.max(currentYear + 1, maxDataYear, 2025);
        monthSelect.innerHTML = monthNames
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join('');
        yearSelect.innerHTML = Array.from({ length: maxYear - 2025 + 1 }, (_, index) => 2025 + index)
            .map((year) => `<option value="${year}">${year}</option>`)
            .join('');

        syncManualCycleControls();
    }

    function syncManualCycleControls() {
        const cycle = activeManualCycleStart();
        const manual = manualOverviewData();
        const monthSelect = byId('manualCycleMonth');
        const yearSelect = byId('manualCycleYear');
        if (monthSelect) monthSelect.value = cycle.slice(5, 7);
        if (yearSelect) yearSelect.value = cycle.slice(0, 4);
        setText('manualCycleLabel', manualCycleLabelFor(cycle));
        if (byId('manualSalary')) byId('manualSalary').value = manual.salary || manual.availableUntilSalary || '';
        selectedMode = 'month';
        selectedMonth = cycle.slice(0, 7);
    }

    function changeManualCycle() {
        const manual = ensureManualOverviewSettings();
        manual.activeCycle = cycleStartFromManualControls();
        manual.cycles[manual.activeCycle] = manual.cycles[manual.activeCycle] || {};
        saveSettings();
        syncManualCycleControls();
        renderDashboard();
    }

    function saveManualOverviewInputs() {
        const manual = manualOverviewData();
        manual.salary = roundMoney(Number(byId('manualSalary')?.value || 0));
        delete manual.availableUntilSalary;
        delete manual.safeDailySpend;
        delete manual.priorityRemaining;
        delete manual.goalSaveProgress;
        manual.updatedAt = new Date().toISOString();
        saveSettings();
        syncManualCycleControls();
        renderDashboard();
        if (byId('financialDashboardEditor')) byId('financialDashboardEditor').hidden = true;
        showLocalToast('success', 'Overview saved', 'This cycle is saved and previous cycles are kept.');
    }

    function bindFilters() {
        document.querySelectorAll('[data-open-settings]').forEach((button) => {
            button.addEventListener('click', () => openSettings(button.dataset.openSettings));
        });

        byId('closeSettings').addEventListener('click', () => {
            byId('settingsPanel').hidden = true;
        });

        byId('privacyToggle').addEventListener('click', () => {
            privacyOn = !privacyOn;
            applyPrivacyState();
        });

        byId('editFinancialDashboard')?.addEventListener('click', () => {
            const editor = byId('financialDashboardEditor');
            editor.hidden = !editor.hidden;
            if (!editor.hidden) syncManualCycleControls();
        });

        byId('cancelManualOverview')?.addEventListener('click', () => {
            byId('financialDashboardEditor').hidden = true;
            syncManualCycleControls();
        });

        byId('editPriorityItems')?.addEventListener('click', () => {
            const editor = byId('priorityChecklistEditor');
            editor.hidden = !editor.hidden;
            if (!editor.hidden) renderPriorityChecklistEditor(priorityPlanStatus());
        });

        byId('priorityChecklistEditor')?.addEventListener('click', (event) => {
            if (event.target.closest('#savePriorityEdit')) savePriorityChecklistEditor();
            if (event.target.closest('#resetPriorityEdit')) resetPriorityChecklistTargets();
            if (event.target.closest('#cancelPriorityEdit')) {
                byId('priorityChecklistEditor').hidden = true;
            }
        });

        byId('manualCycleMonth')?.addEventListener('change', changeManualCycle);
        byId('manualCycleYear')?.addEventListener('change', changeManualCycle);
        byId('saveManualOverview')?.addEventListener('click', saveManualOverviewInputs);

        byId('goalSaveTarget').addEventListener('change', (event) => {
            userSettings.goalSaveTarget = Number(event.target.value || 0);
            saveSettings();
            renderDashboard();
        });

        document.querySelectorAll('.range-chip').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.range-chip').forEach((item) => item.classList.remove('active'));
                byId('monthFilter').classList.remove('active');
                button.classList.add('active');
                selectedMode = 'range';
                selectedRange = button.dataset.months;
                renderDashboard();
            });
        });

        byId('viewMonthButton')?.addEventListener('click', () => {
            const month = byId('monthSelect').value;
            const year = byId('yearSelect').value;
            selectedMode = 'month';
            selectedMonth = `${year}-${month}`;
            document.querySelectorAll('.range-chip').forEach((item) => item.classList.remove('active'));
            byId('monthFilter').classList.add('active');
            renderDashboard();
        });

        document.querySelectorAll('.filter-chip').forEach((button) => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
                button.classList.add('active');
                activeFilter = button.dataset.filter;
                renderTransactions();
            });
        });

        byId('transactionSearch').addEventListener('input', (event) => {
            searchTerm = event.target.value.trim().toLowerCase();
            renderTransactions();
        });
    }

    function currentYearMonth() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    function latestAvailableCycleMonth() {
        const latestCycle = completedFinancialCycles().at(-1);
        return latestCycle ? latestCycle.start.slice(0, 7) : currentYearMonth();
    }

    function populateMonthControls() {
        const monthSelect = byId('monthSelect');
        const yearSelect = byId('yearSelect');
        if (!monthSelect || !yearSelect) return;
        const currentYear = new Date().getFullYear();
        const maxDataYear = allKnownDates().reduce((max, item) => Math.max(max, Number(item.slice(0, 4))), 2025);
        const maxYear = Math.max(currentYear, maxDataYear, 2025);

        monthSelect.innerHTML = monthNames
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join('');
        yearSelect.innerHTML = Array.from({ length: maxYear - 2025 + 1 }, (_, index) => 2025 + index)
            .map((year) => `<option value="${year}">${year}</option>`)
            .join('');

        const latest = latestAvailableCycleMonth();
        selectedMonth = latest;
        monthSelect.value = latest.slice(5);
        yearSelect.value = latest.slice(0, 4);
        selectedMode = 'range';
        selectedRange = '1';
        byId('monthFilter').classList.remove('active');
        document.querySelectorAll('.range-chip').forEach((item) => {
            item.classList.toggle('active', item.dataset.months === '1');
        });
    }

    window.BankDashData = {
        setData: setDashboardSourceData,
        getData: () => sourceData,
        empty: () => normalizeSourceData(emptySourceData),
    };

    rolloverManualCycleIfNeeded();
    applyPrivacyState();
    populateMonthControls();
    populateManualCycleControls();
    renderDashboard();
    bindFilters();
})();
