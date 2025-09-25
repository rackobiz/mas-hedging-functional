// MAS Hedging Functional Platform - Main Application
class MASHedgingApp {
    constructor() {
        this.currentUser = null;
        this.authToken = localStorage.getItem('authToken');
        this.currentSection = 'home';
        this.marketData = {};
        this.charts = {};
        
        this.init();
    }

    async init() {
        this.initVantaBackground();
        this.setupEventListeners();
        this.setupNavigation();
        
        // Check if user is already logged in
        if (this.authToken) {
            await this.validateToken();
        }
        
        // Start real-time updates
        this.startMarketDataUpdates();
        
        // Set default dates for position form
        this.setDefaultDates();
        
        console.log('🚀 MAS Hedging Platform initialized');
    }

    initVantaBackground() {
        try {
            if (window.VANTA && window.THREE) {
                VANTA.GLOBE({
                    el: "#vanta-bg",
                    mouseControls: true,
                    touchControls: true,
                    gyroControls: false,
                    minHeight: 200.00,
                    minWidth: 200.00,
                    scale: 1.00,
                    scaleMobile: 1.00,
                    color: 0x3b82f6,
                    backgroundColor: 0x111827
                });
            }
        } catch (error) {
            console.warn('Vanta.js background failed to load:', error);
        }
    }

    setupEventListeners() {
        // Authentication
        document.getElementById('sign-in-btn').addEventListener('click', () => this.showModal('signin-modal'));
        document.getElementById('sign-up-btn').addEventListener('click', () => this.showModal('signup-modal'));
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        
        // Modal controls
        document.getElementById('close-signin').addEventListener('click', () => this.hideModal('signin-modal'));
        document.getElementById('close-signup').addEventListener('click', () => this.hideModal('signup-modal'));
        document.getElementById('signin-backdrop').addEventListener('click', () => this.hideModal('signin-modal'));
        document.getElementById('signup-backdrop').addEventListener('click', () => this.hideModal('signup-modal'));
        
        // Modal switching
        document.getElementById('switch-to-signup').addEventListener('click', () => {
            this.hideModal('signin-modal');
            this.showModal('signup-modal');
        });
        document.getElementById('switch-to-signin').addEventListener('click', () => {
            this.hideModal('signup-modal');
            this.showModal('signin-modal');
        });
        
        // Forms
        document.getElementById('signin-form').addEventListener('submit', (e) => this.handleSignIn(e));
        document.getElementById('signup-form').addEventListener('submit', (e) => this.handleSignUp(e));
        
        // Position management
        document.getElementById('new-position-btn').addEventListener('click', () => this.showModal('new-position-modal'));
        document.getElementById('close-position-modal').addEventListener('click', () => this.hideModal('new-position-modal'));
        document.getElementById('position-backdrop').addEventListener('click', () => this.hideModal('new-position-modal'));
        document.getElementById('new-position-form').addEventListener('submit', (e) => this.handleNewPosition(e));
        
        // Market data
        document.getElementById('refresh-market-btn').addEventListener('click', () => this.loadMarketData());
        
        // Filters
        document.getElementById('position-status-filter').addEventListener('change', () => this.loadPositions());
        document.getElementById('position-metal-filter').addEventListener('change', () => this.loadPositions());
        
        // Mobile menu
        document.getElementById('mobile-menu-btn').addEventListener('click', () => this.toggleMobileMenu());
        
        // Action buttons
        document.getElementById('get-started-btn').addEventListener('click', () => {
            if (this.currentUser) {
                this.showSection('dashboard');
            } else {
                this.showModal('signup-modal');
            }
        });
        
        document.getElementById('watch-demo-btn').addEventListener('click', () => this.showDemo());
    }

    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link, a[href^="#"]');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.getAttribute('href').substring(1);
                this.showSection(section);
            });
        });
    }

    showSection(sectionName) {
        // Hide all sections
        const sections = ['home', 'dashboard', 'market', 'positions', 'analytics'];
        sections.forEach(section => {
            const element = document.getElementById(section);
            if (element) {
                element.style.display = 'none';
            }
        });
        
        // Show requested section
        const targetSection = document.getElementById(sectionName);
        if (targetSection) {
            targetSection.style.display = 'block';
            this.currentSection = sectionName;
            
            // Load section-specific data
            this.loadSectionData(sectionName);
            
            // Update navigation
            this.updateNavigation();
        }
    }

    async loadSectionData(section) {
        if (!this.currentUser && section !== 'home' && section !== 'market') {
            this.showNotification('Please sign in to access this section', 'warning');
            this.showSection('home');
            return;
        }

        switch (section) {
            case 'dashboard':
                await this.loadDashboard();
                break;
            case 'market':
                await this.loadMarketData();
                break;
            case 'positions':
                await this.loadPositions();
                break;
            case 'analytics':
                await this.loadAnalytics();
                break;
        }
    }

    updateNavigation() {
        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('text-blue-400');
            if (link.getAttribute('href') === `#${this.currentSection}`) {
                link.classList.add('text-blue-400');
            }
        });
    }

    showModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
        document.body.style.overflow = 'auto';
    }

    toggleMobileMenu() {
        const mobileMenu = document.getElementById('mobile-menu');
        mobileMenu.classList.toggle('hidden');
    }

    async handleSignIn(e) {
        e.preventDefault();
        
        const email = document.getElementById('signin-email').value;
        const password = document.getElementById('signin-password').value;
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.authToken = data.token;
                this.currentUser = data.user;
                localStorage.setItem('authToken', this.authToken);
                
                this.updateUIForLoggedInUser();
                this.hideModal('signin-modal');
                this.showNotification('Welcome back!', 'success');
                this.showSection('dashboard');
            } else {
                this.showNotification(data.error || 'Sign in failed', 'error');
            }
        } catch (error) {
            console.error('Sign in error:', error);
            this.showNotification('Network error. Please try again.', 'error');
        }
    }

    async handleSignUp(e) {
        e.preventDefault();
        
        const firstName = document.getElementById('signup-firstname').value;
        const lastName = document.getElementById('signup-lastname').value;
        const email = document.getElementById('signup-email').value;
        const company = document.getElementById('signup-company').value;
        const password = document.getElementById('signup-password').value;
        
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ firstName, lastName, email, company, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.hideModal('signup-modal');
                this.showNotification('Account created successfully! Please sign in.', 'success');
                this.showModal('signin-modal');
            } else {
                this.showNotification(data.error || 'Registration failed', 'error');
            }
        } catch (error) {
            console.error('Sign up error:', error);
            this.showNotification('Network error. Please try again.', 'error');
        }
    }

    async handleNewPosition(e) {
        e.preventDefault();
        
        const formData = {
            metalType: document.getElementById('position-metal').value,
            positionType: document.getElementById('position-type').value,
            quantity: parseFloat(document.getElementById('position-quantity').value),
            entryPrice: parseFloat(document.getElementById('position-entry-price').value),
            targetPrice: document.getElementById('position-target-price').value ? parseFloat(document.getElementById('position-target-price').value) : null,
            stopLoss: document.getElementById('position-stop-loss').value ? parseFloat(document.getElementById('position-stop-loss').value) : null,
            contractDate: document.getElementById('position-contract-date').value,
            expiryDate: document.getElementById('position-expiry-date').value
        };
        
        try {
            const response = await fetch('/api/hedging/positions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify(formData)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.hideModal('new-position-modal');
                this.showNotification('Position created successfully!', 'success');
                document.getElementById('new-position-form').reset();
                this.setDefaultDates();
                
                // Reload positions if we're on that section
                if (this.currentSection === 'positions') {
                    await this.loadPositions();
                }
            } else {
                this.showNotification(data.error || 'Failed to create position', 'error');
            }
        } catch (error) {
            console.error('Create position error:', error);
            this.showNotification('Network error. Please try again.', 'error');
        }
    }

    async validateToken() {
        try {
            const response = await fetch('/api/users/profile', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.user;
                this.updateUIForLoggedInUser();
            } else {
                // Token is invalid
                this.logout();
            }
        } catch (error) {
            console.error('Token validation error:', error);
            this.logout();
        }
    }

    updateUIForLoggedInUser() {
        document.getElementById('auth-buttons').classList.add('hidden');
        document.getElementById('user-menu').classList.remove('hidden');
        document.getElementById('user-name').textContent = `${this.currentUser.firstName} ${this.currentUser.lastName}`;
    }

    logout() {
        this.authToken = null;
        this.currentUser = null;
        localStorage.removeItem('authToken');
        
        document.getElementById('auth-buttons').classList.remove('hidden');
        document.getElementById('user-menu').classList.add('hidden');
        
        this.showSection('home');
        this.showNotification('Logged out successfully', 'info');
    }

    async loadDashboard() {
        try {
            const response = await fetch('/api/dashboard/overview', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.renderDashboardOverview(data);
                await this.loadDashboardCharts();
            } else {
                this.showNotification('Failed to load dashboard data', 'error');
            }
        } catch (error) {
            console.error('Dashboard load error:', error);
            this.showNotification('Network error loading dashboard', 'error');
        }
    }

    renderDashboardOverview(data) {
        const overviewContainer = document.getElementById('dashboard-overview');
        overviewContainer.innerHTML = `
            <div class="glass-effect rounded-xl p-6 border border-white/10">
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Total Positions</h3>
                <p class="text-3xl font-bold">${data.summary.totalPositions}</p>
                <p class="text-sm text-gray-400">${data.summary.activePositions} active</p>
            </div>
            <div class="glass-effect rounded-xl p-6 border border-white/10">
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Unrealized P&L</h3>
                <p class="text-3xl font-bold ${data.summary.totalUnrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}">
                    $${data.summary.totalUnrealizedPnL.toLocaleString()}
                </p>
                <p class="text-sm text-gray-400">Current positions</p>
            </div>
            <div class="glass-effect rounded-xl p-6 border border-white/10">
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Realized P&L</h3>
                <p class="text-3xl font-bold ${data.summary.totalRealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}">
                    $${data.summary.totalRealizedPnL.toLocaleString()}
                </p>
                <p class="text-sm text-gray-400">Closed positions</p>
            </div>
            <div class="glass-effect rounded-xl p-6 border border-white/10">
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Win Rate</h3>
                <p class="text-3xl font-bold text-blue-400">${data.summary.winRate}%</p>
                <p class="text-sm text-gray-400">${data.summary.closedPositions} trades</p>
            </div>
        `;
        
        // Render recent activity
        const activityContainer = document.getElementById('recent-activity');
        if (data.recentActivity && data.recentActivity.length > 0) {
            activityContainer.innerHTML = data.recentActivity.map(activity => `
                <div class="flex justify-between items-center py-2 border-b border-white/10 last:border-b-0">
                    <div>
                        <p class="font-medium">${activity.action.replace(/_/g, ' ')}</p>
                        <p class="text-sm text-gray-400">${activity.details}</p>
                    </div>
                    <span class="text-sm text-gray-400">${activity.created_at}</span>
                </div>
            `).join('');
        } else {
            activityContainer.innerHTML = '<p class="text-gray-400 text-center py-4">No recent activity</p>';
        }
    }

    async loadDashboardCharts() {
        try {
            // Load performance data
            const perfResponse = await fetch('/api/dashboard/performance?period=30d', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (perfResponse.ok) {
                const perfData = await perfResponse.json();
                this.renderPerformanceChart(perfData);
            }
            
            // Load risk metrics
            const riskResponse = await fetch('/api/dashboard/risk-metrics', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (riskResponse.ok) {
                const riskData = await riskResponse.json();
                this.renderRiskChart(riskData);
            }
        } catch (error) {
            console.error('Charts load error:', error);
        }
    }

    renderPerformanceChart(data) {
        const ctx = document.getElementById('performance-chart').getContext('2d');
        
        if (this.charts.performance) {
            this.charts.performance.destroy();
        }
        
        this.charts.performance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.data.map(d => d.period),
                datasets: [{
                    label: 'Cumulative P&L',
                    data: data.data.map(d => d.cumulative_pnl),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#ffffff' }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#9ca3af' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    },
                    y: {
                        ticks: { color: '#9ca3af' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    }
                }
            }
        });
    }

    renderRiskChart(data) {
        const ctx = document.getElementById('risk-chart').getContext('2d');
        
        if (this.charts.risk) {
            this.charts.risk.destroy();
        }
        
        this.charts.risk = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.metalExposure.map(m => m.metal.toUpperCase()),
                datasets: [{
                    data: data.metalExposure.map(m => m.percentage),
                    backgroundColor: [
                        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#ffffff' }
                    }
                }
            }
        });
    }

    async loadMarketData() {
        try {
            const response = await fetch('/api/market/data');
            
            if (response.ok) {
                const data = await response.json();
                this.marketData = data.data;
                this.renderMarketData();
                this.updateMarketTicker();
            } else {
                this.showNotification('Failed to load market data', 'error');
            }
        } catch (error) {
            console.error('Market data load error:', error);
            this.showNotification('Network error loading market data', 'error');
        }
    }

    renderMarketData() {
        const tableBody = document.getElementById('market-table-body');
        if (!tableBody) return;
        
        const metals = Object.keys(this.marketData);
        tableBody.innerHTML = metals.map(metal => {
            const data = this.marketData[metal];
            const changeClass = data.change_percent >= 0 ? 'text-green-400' : 'text-red-400';
            const changeSymbol = data.change_percent >= 0 ? '+' : '';
            
            return `
                <tr class="border-b border-white/10 hover:bg-white/5">
                    <td class="py-3 px-4 font-medium">${metal.toUpperCase()}</td>
                    <td class="py-3 px-4 text-right">$${data.price.toLocaleString()}</td>
                    <td class="py-3 px-4 text-right ${changeClass}">
                        ${changeSymbol}${data.change_percent.toFixed(2)}%
                    </td>
                    <td class="py-3 px-4 text-right">${(data.volume || 0).toLocaleString()}</td>
                    <td class="py-3 px-4 text-center">
                        <button onclick="app.createQuickPosition('${metal}')" 
                                class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors">
                            Trade
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    updateMarketTicker() {
        const tickerContent = document.getElementById('ticker-content');
        if (!tickerContent) return;
        
        const metals = Object.keys(this.marketData).slice(0, 6);
        tickerContent.innerHTML = metals.map(metal => {
            const data = this.marketData[metal];
            const changeClass = data.change_percent >= 0 ? 'text-green-400' : 'text-red-400';
            const changeSymbol = data.change_percent >= 0 ? '+' : '';
            
            return `
                <div class="text-center">
                    <div class="font-semibold">${metal.toUpperCase()}</div>
                    <div class="text-lg font-bold">$${data.price.toLocaleString()}</div>
                    <div class="text-sm ${changeClass}">
                        ${changeSymbol}${data.change_percent.toFixed(2)}%
                    </div>
                </div>
            `;
        }).join('');
    }

    async loadPositions() {
        if (!this.currentUser) return;
        
        try {
            const status = document.getElementById('position-status-filter').value;
            const metal = document.getElementById('position-metal-filter').value;
            
            const params = new URLSearchParams();
            if (status !== 'all') params.append('status', status);
            if (metal !== 'all') params.append('metal', metal);
            
            const response = await fetch(`/api/hedging/positions?${params}`, {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.renderPositions(data.positions);
            } else {
                this.showNotification('Failed to load positions', 'error');
            }
        } catch (error) {
            console.error('Positions load error:', error);
            this.showNotification('Network error loading positions', 'error');
        }
    }

    renderPositions(positions) {
        const tableBody = document.getElementById('positions-table-body');
        if (!tableBody) return;
        
        if (positions.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="py-8 text-center text-gray-400">
                        No positions found. <button onclick="app.showModal('new-position-modal')" class="text-blue-400 hover:text-blue-300">Create your first position</button>
                    </td>
                </tr>
            `;
            return;
        }
        
        tableBody.innerHTML = positions.map(position => {
            const pnlClass = position.profit_loss >= 0 ? 'text-green-400' : 'text-red-400';
            const statusClass = position.status === 'active' ? 'text-green-400' : 'text-gray-400';
            
            return `
                <tr class="border-b border-white/10 hover:bg-white/5">
                    <td class="py-3 px-4 font-medium">${position.metal_type.toUpperCase()}</td>
                    <td class="py-3 px-4">
                        <span class="px-2 py-1 rounded text-xs ${position.position_type === 'long' ? 'bg-green-600' : 'bg-red-600'}">
                            ${position.position_type.toUpperCase()}
                        </span>
                    </td>
                    <td class="py-3 px-4 text-right">${position.quantity}</td>
                    <td class="py-3 px-4 text-right">$${position.entry_price.toLocaleString()}</td>
                    <td class="py-3 px-4 text-right">$${(position.current_market_price || position.entry_price).toLocaleString()}</td>
                    <td class="py-3 px-4 text-right ${pnlClass}">
                        $${position.profit_loss.toLocaleString()}
                        <div class="text-xs">(${position.profit_loss_percent.toFixed(2)}%)</div>
                    </td>
                    <td class="py-3 px-4 text-center">
                        <span class="px-2 py-1 rounded text-xs ${statusClass} bg-gray-700">
                            ${position.status.toUpperCase()}
                        </span>
                    </td>
                    <td class="py-3 px-4 text-center">
                        ${position.status === 'active' ? `
                            <button onclick="app.closePosition(${position.id})" 
                                    class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors">
                                Close
                            </button>
                        ` : '-'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    async loadAnalytics() {
        if (!this.currentUser) return;
        
        try {
            const response = await fetch('/api/hedging/analytics?period=30d', {
                headers: { 'Authorization': `Bearer ${this.authToken}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.renderAnalytics(data);
            } else {
                this.showNotification('Failed to load analytics', 'error');
            }
        } catch (error) {
            console.error('Analytics load error:', error);
            this.showNotification('Network error loading analytics', 'error');
        }
    }

    renderAnalytics(data) {
        const overviewContainer = document.getElementById('analytics-overview');
        overviewContainer.innerHTML = `
            <div class="glass-effect rounded-xl p-6 border border-white/10">
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Total Trades</h3>
                <p class="text-3xl font-bold">${data.overallStats.total_positions}</p>
                <p class="text-sm text-gray-400">${data.overallStats.active_positions} active</p>
            </div>
            <div class="glass-effect rounded-xl p-6 border border-white/10">
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Win Rate</h3>
                <p class="text-3xl font-bold text-blue-400">${data.overallStats.win_rate}%</p>
                <p class="text-sm text-gray-400">${data.overallStats.winning_positions}/${data.overallStats.closed_positions} wins</p>
            </div>
            <div class="glass-effect rounded-xl p-6 border border-white/10">
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Avg Trade P&L</h3>
                <p class="text-3xl font-bold ${data.overallStats.avg_trade_pnl >= 0 ? 'text-green-400' : 'text-red-400'}">
                    $${data.overallStats.avg_trade_pnl.toLocaleString()}
                </p>
                <p class="text-sm text-gray-400">Per closed trade</p>
            </div>
        `;
    }

    createQuickPosition(metal) {
        if (!this.currentUser) {
            this.showNotification('Please sign in to create positions', 'warning');
            this.showModal('signin-modal');
            return;
        }
        
        // Pre-fill the form with the selected metal and current price
        document.getElementById('position-metal').value = metal;
        if (this.marketData[metal]) {
            document.getElementById('position-entry-price').value = this.marketData[metal].price;
        }
        
        this.showModal('new-position-modal');
    }

    async closePosition(positionId) {
        if (!confirm('Are you sure you want to close this position?')) return;
        
        try {
            const response = await fetch(`/api/hedging/positions/${positionId}/close`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.showNotification(`Position closed with P&L: $${data.finalPnL}`, 'success');
                await this.loadPositions();
            } else {
                const error = await response.json();
                this.showNotification(error.error || 'Failed to close position', 'error');
            }
        } catch (error) {
            console.error('Close position error:', error);
            this.showNotification('Network error. Please try again.', 'error');
        }
    }

    startMarketDataUpdates() {
        // Update market data every 30 seconds
        setInterval(() => {
            if (this.currentSection === 'market' || this.currentSection === 'home') {
                this.loadMarketData();
            }
        }, 30000);
        
        // Initial load
        this.loadMarketData();
    }

    setDefaultDates() {
        const today = new Date();
        const nextMonth = new Date(today);
        nextMonth.setMonth(today.getMonth() + 1);
        
        document.getElementById('position-contract-date').value = today.toISOString().split('T')[0];
        document.getElementById('position-expiry-date').value = nextMonth.toISOString().split('T')[0];
    }

    showDemo() {
        this.showNotification('Demo feature coming soon!', 'info');
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notification-container');
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        container.appendChild(notification);
        
        // Show notification
        setTimeout(() => notification.classList.add('show'), 100);
        
        // Hide and remove notification
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => container.removeChild(notification), 300);
        }, 5000);
    }
}

// Initialize the application
const app = new MASHedgingApp();
