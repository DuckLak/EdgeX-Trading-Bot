// EdgeX 자동매매 봇 - 독립 실행형 JavaScript
// 실행 방법: node edgex-trading-bot.js
// 필요: npm install node-fetch crypto

const fetch = require('node-fetch');
const crypto = require('crypto');
const readline = require('readline');

// 설정 파일
const config = {
    edgex: {
        apiKey: 'YOUR_API_KEY_HERE',
        secretKey: 'YOUR_SECRET_KEY_HERE',
        publicUrl: 'https://pro.edgex.exchange/api/v1/public',
        privateUrl: 'https://pro.edgex.exchange/api/v1/private'
    },
    trading: {
        defaultLeverage: 3,
        maxPositionSize: 10,
        emergencyStopLoss: 0.05 // 5% 긴급 손절
    }
};

// 콘솔 색상
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    const timestamp = new Date().toLocaleTimeString('ko-KR');
    console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

// EdgeX API 클래스
class EdgeXAPI {
    constructor() {
        this.contractIds = {
            'BTC': '10000001', 'ETH': '10000002', 'SOL': '10000003', 'DOGE': '10000004', 'XRP': '10000005',
            'ADA': '10000006', 'AVAX': '10000007', 'SHIB': '10000008', 'DOT': '10000009', 'LINK': '10000010'
        };
    }

    // HMAC SHA256 서명 생성
    createSignature(message, secret) {
        return crypto.createHmac('sha256', secret).update(message).digest('hex');
    }

    // 인증 헤더 생성
    createAuthHeaders(method, endpoint, body = '') {
        const timestamp = Date.now().toString();
        const message = timestamp + method + endpoint + body;
        const signature = this.createSignature(message, config.edgex.secretKey);

        return {
            'X-API-KEY': config.edgex.apiKey,
            'X-TIMESTAMP': timestamp,
            'X-SIGNATURE': signature,
            'Content-Type': 'application/json',
            'User-Agent': 'EdgeX-TradingBot/1.0'
        };
    }

    // Public API 호출
    async callPublicAPI(endpoint) {
        try {
            const response = await fetch(`${config.edgex.publicUrl}${endpoint}`);
            return await response.json();
        } catch (error) {
            log(`Public API 오류: ${error.message}`, 'red');
            return null;
        }
    }

    // Private API 호출
    async callPrivateAPI(endpoint, method = 'GET', data = null) {
        try {
            const body = data ? JSON.stringify(data) : '';
            const headers = this.createAuthHeaders(method, endpoint, body);
            
            const options = {
                method,
                headers,
                ...(body && { body })
            };

            const response = await fetch(`${config.edgex.privateUrl}${endpoint}`, options);
            const result = await response.json();
            
            if (result.code === 'SUCCESS') {
                return result.data;
            } else {
                log(`Private API 오류: ${result.msg}`, 'red');
                return null;
            }
        } catch (error) {
            log(`Private API 호출 실패: ${error.message}`, 'red');
            return null;
        }
    }

    // 현재 가격 조회
    async getCurrentPrice(symbol) {
        const contractId = this.contractIds[symbol.toUpperCase()];
        if (!contractId) {
            log(`지원하지 않는 심볼: ${symbol}`, 'red');
            return null;
        }

        const data = await this.callPublicAPI(`/quote/getTicker?contractId=${contractId}`);
        if (data && data.code === 'SUCCESS' && data.data.length > 0) {
            return parseFloat(data.data[0].lastPrice);
        }
        return null;
    }

    // 계좌 정보 조회
    async getAccountInfo() {
        return await this.callPrivateAPI('/account');
    }

    // 포지션 조회
    async getPosition(symbol) {
        return await this.callPrivateAPI(`/position/${symbol}`);
    }

    // 주문 생성
    async placeOrder(symbol, side, type, amount, price = null) {
        const orderData = {
            contractName: symbol + 'USD',
            side: side.toUpperCase(),
            type: type.toUpperCase(),
            amount: amount.toString(),
            ...(price && { price: price.toString() })
        };

        const result = await this.callPrivateAPI('/order', 'POST', orderData);
        if (result) {
            log(`${side} 주문 생성: ${symbol} $${price || 'MARKET'} x ${amount}`, 'green');
            return result;
        }
        return null;
    }

    // 주문 취소
    async cancelOrder(orderId) {
        return await this.callPrivateAPI(`/order/${orderId}`, 'DELETE');
    }

    // 모든 주문 조회
    async getOpenOrders(symbol = null) {
        const endpoint = symbol ? `/orders?symbol=${symbol}` : '/orders';
        return await this.callPrivateAPI(endpoint);
    }
}

// 매매 전략 클래스
class TradingStrategy {
    constructor(api) {
        this.api = api;
        this.activeStrategies = new Map();
    }

    // 그리드 트레이딩
    async gridTrading(symbol, centerPrice, gridSpacing, orderSize) {
        log(`그리드 트레이딩 시작: ${symbol}`, 'cyan');
        log(`중심가: $${centerPrice} | 간격: $${gridSpacing} | 수량: ${orderSize}`, 'blue');

        const gridLevels = [];
        for (let i = -5; i <= 5; i++) {
            if (i === 0) continue;
            gridLevels.push({
                price: centerPrice + (i * gridSpacing),
                side: i < 0 ? 'BUY' : 'SELL',
                amount: orderSize
            });
        }

        const orders = [];
        for (const level of gridLevels) {
            const order = await this.api.placeOrder(symbol, level.side, 'LIMIT', level.amount, level.price);
            if (order) {
                orders.push(order);
                await new Promise(resolve => setTimeout(resolve, 100)); // API 제한 방지
            }
        }

        this.activeStrategies.set(`${symbol}_GRID`, {
            type: 'GRID',
            symbol,
            orders,
            centerPrice,
            gridSpacing,
            orderSize
        });

        log(`그리드 주문 ${orders.length}개 배치 완료`, 'green');
        return orders;
    }

    // DCA (물타기) 전략
    async dcaStrategy(symbol, targetPrice, stepPercent, baseAmount) {
        log(`DCA 전략 시작: ${symbol}`, 'cyan');
        log(`목표가: $${targetPrice} | 단계: ${stepPercent}% | 기본수량: ${baseAmount}`, 'blue');

        const currentPrice = await this.api.getCurrentPrice(symbol);
        if (!currentPrice) {
            log('가격 조회 실패', 'red');
            return null;
        }

        const dcaLevels = [];
        for (let i = 1; i <= 5; i++) {
            const price = targetPrice * (1 - (stepPercent * i / 100));
            const amount = baseAmount * i;
            if (price < currentPrice) {
                dcaLevels.push({ price, amount });
            }
        }

        const orders = [];
        for (const level of dcaLevels) {
            const order = await this.api.placeOrder(symbol, 'BUY', 'LIMIT', level.amount, level.price);
            if (order) {
                orders.push(order);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        this.activeStrategies.set(`${symbol}_DCA`, {
            type: 'DCA',
            symbol,
            orders,
            targetPrice,
            stepPercent,
            baseAmount
        });

        log(`DCA 주문 ${orders.length}개 배치 완료`, 'green');
        return orders;
    }

    // 스캘핑 전략
    async scalpingStrategy(symbol, profitPercent, stopPercent, orderSize) {
        log(`스캘핑 전략 시작: ${symbol}`, 'cyan');
        log(`목표수익: ${profitPercent}% | 손절: ${stopPercent}% | 수량: ${orderSize}`, 'blue');

        const currentPrice = await this.api.getCurrentPrice(symbol);
        if (!currentPrice) {
            log('가격 조회 실패', 'red');
            return null;
        }

        // 시장가 매수
        const buyOrder = await this.api.placeOrder(symbol, 'BUY', 'MARKET', orderSize);
        if (!buyOrder) {
            log('매수 주문 실패', 'red');
            return null;
        }

        log(`매수 체결: $${currentPrice} x ${orderSize}`, 'green');

        // 익절 주문
        const takeProfitPrice = currentPrice * (1 + profitPercent / 100);
        const takeProfitOrder = await this.api.placeOrder(symbol, 'SELL', 'LIMIT', orderSize, takeProfitPrice);

        // 손절 주문 (실제로는 Stop Loss 주문 타입 필요)
        const stopLossPrice = currentPrice * (1 - stopPercent / 100);
        
        log(`익절가: $${takeProfitPrice.toFixed(2)}`, 'yellow');
        log(`손절가: $${stopLossPrice.toFixed(2)}`, 'yellow');

        this.activeStrategies.set(`${symbol}_SCALP`, {
            type: 'SCALP',
            symbol,
            buyOrder,
            takeProfitOrder,
            takeProfitPrice,
            stopLossPrice,
            orderSize
        });

        return { buyOrder, takeProfitOrder };
    }

    // 추세 추종 전략
    async trendFollowingStrategy(symbol, orderSize, leverage) {
        log(`추세 추종 전략 시작: ${symbol}`, 'cyan');
        log(`수량: ${orderSize} | 레버리지: ${leverage}x`, 'blue');

        const currentPrice = await this.api.getCurrentPrice(symbol);
        if (!currentPrice) {
            log('가격 조회 실패', 'red');
            return null;
        }

        // 간단한 추세 판단 (실제로는 더 복잡한 로직 필요)
        const position = await this.api.getPosition(symbol);
        const trend = this.analyzeTrend(symbol); // 추세 분석 함수 호출

        let order = null;
        if (trend === 'UP' && (!position || position.size <= 0)) {
            order = await this.api.placeOrder(symbol, 'BUY', 'MARKET', orderSize);
            log(`상승 추세 매수: $${currentPrice}`, 'green');
        } else if (trend === 'DOWN' && position && position.size > 0) {
            order = await this.api.placeOrder(symbol, 'SELL', 'MARKET', orderSize);
            log(`하락 추세 매도: $${currentPrice}`, 'red');
        }

        if (order) {
            this.activeStrategies.set(`${symbol}_TREND`, {
                type: 'TREND',
                symbol,
                order,
                leverage
            });
        }

        return order;
    }

    // 간단한 추세 분석 (실제로는 더 정교한 분석 필요)
    analyzeTrend(symbol) {
        // 임시 구현 - 실제로는 이동평균, RSI 등을 활용
        return Math.random() > 0.5 ? 'UP' : 'DOWN';
    }

    // 모든 전략 중지
    async stopAllStrategies(symbol) {
        log(`${symbol} 모든 전략 중지`, 'yellow');

        // 열린 주문 취소
        const orders = await this.api.getOpenOrders(symbol);
        if (orders && orders.length > 0) {
            for (const order of orders) {
                await this.api.cancelOrder(order.id);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            log(`${orders.length}개 주문 취소 완료`, 'green');
        }

        // 포지션 정리
        const position = await this.api.getPosition(symbol);
        if (position && position.size !== 0) {
            const side = position.size > 0 ? 'SELL' : 'BUY';
            await this.api.placeOrder(symbol, side, 'MARKET', Math.abs(position.size));
            log('포지션 정리 완료', 'green');
        }

        // 활성 전략 제거
        for (const [key] of this.activeStrategies) {
            if (key.startsWith(symbol)) {
                this.activeStrategies.delete(key);
            }
        }
    }

    // 전략 상태 표시
    displayActiveStrategies() {
        log('=== 활성 전략 현황 ===', 'cyan');
        if (this.activeStrategies.size === 0) {
            log('활성 전략 없음', 'yellow');
        } else {
            for (const [key, strategy] of this.activeStrategies) {
                log(`${strategy.type}: ${strategy.symbol}`, 'blue');
            }
        }
        log('==================', 'cyan');
    }
}

// 메인 봇 클래스
class EdgeXTradingBot {
    constructor() {
        this.api = new EdgeXAPI();
        this.strategy = new TradingStrategy(this.api);
        this.isRunning = false;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    // 봇 시작
    async start() {
        log('EdgeX 자동매매 봇 시작', 'green');
        log('경고: 실제 자금 투입 전 충분한 테스트 필요', 'red');
        
        this.isRunning = true;
        this.showHelp();
        this.startCommandInterface();

        // 포지션 모니터링 시작 (5분마다)
        this.monitoringInterval = setInterval(() => {
            this.monitorPositions();
        }, 5 * 60 * 1000);
    }

    // 도움말 표시
    showHelp() {
        console.log(`
${colors.cyan}=== EdgeX 자동매매 봇 명령어 ===${colors.reset}
grid [심볼] [중심가] [간격] [수량]     - 그리드 트레이딩
  예: grid BTC 50000 100 0.1

dca [심볼] [목표가] [단계%] [기본수량]  - DCA 전략
  예: dca ETH 3000 5 0.5

scalp [심볼] [수익%] [손절%] [수량]    - 스캘핑
  예: scalp SOL 2 1 1.0

trend [심볼] [수량] [레버리지]         - 추세 추종
  예: trend BTC 0.5 3

stop [심볼]                          - 전략 중지
  예: stop BTC

pos [심볼]                           - 포지션 조회
orders                               - 주문 현황
balance                              - 계좌 잔고
status                               - 전략 상태
help                                 - 도움말
exit                                 - 봇 종료
${colors.cyan}======================================${colors.reset}
        `);
    }

    // 명령어 인터페이스
    startCommandInterface() {
        this.rl.question('명령어 입력: ', async (input) => {
            if (!this.isRunning) return;

            await this.processCommand(input.trim());
            
            if (this.isRunning) {
                this.startCommandInterface();
            }
        });
    }

    // 명령어 처리
    async processCommand(command) {
        const parts = command.split(' ');
        const cmd = parts[0].toLowerCase();

        try {
            switch (cmd) {
                case 'grid':
                    if (parts.length >= 5) {
                        await this.strategy.gridTrading(
                            parts[1].toUpperCase(),
                            parseFloat(parts[2]),
                            parseFloat(parts[3]),
                            parseFloat(parts[4])
                        );
                    } else {
                        log('사용법: grid [심볼] [중심가] [간격] [수량]', 'yellow');
                    }
                    break;

                case 'dca':
                    if (parts.length >= 5) {
                        await this.strategy.dcaStrategy(
                            parts[1].toUpperCase(),
                            parseFloat(parts[2]),
                            parseFloat(parts[3]),
                            parseFloat(parts[4])
                        );
                    } else {
                        log('사용법: dca [심볼] [목표가] [단계%] [기본수량]', 'yellow');
                    }
                    break;

                case 'scalp':
                    if (parts.length >= 5) {
                        await this.strategy.scalpingStrategy(
                            parts[1].toUpperCase(),
                            parseFloat(parts[2]),
                            parseFloat(parts[3]),
                            parseFloat(parts[4])
                        );
                    } else {
                        log('사용법: scalp [심볼] [수익%] [손절%] [수량]', 'yellow');
                    }
                    break;

                case 'trend':
                    if (parts.length >= 4) {
                        await this.strategy.trendFollowingStrategy(
                            parts[1].toUpperCase(),
                            parseFloat(parts[2]),
                            parseFloat(parts[3])
                        );
                    } else {
                        log('사용법: trend [심볼] [수량] [레버리지]', 'yellow');
                    }
                    break;

                case 'stop':
                    if (parts.length >= 2) {
                        await this.strategy.stopAllStrategies(parts[1].toUpperCase());
                    } else {
                        log('사용법: stop [심볼]', 'yellow');
                    }
                    break;

                case 'pos':
                    if (parts.length >= 2) {
                        await this.showPosition(parts[1].toUpperCase());
                    } else {
                        log('사용법: pos [심볼]', 'yellow');
                    }
                    break;

                case 'orders':
                    await this.showOrders();
                    break;

                case 'balance':
                    await this.showBalance();
                    break;

                case 'status':
                    this.strategy.displayActiveStrategies();
                    break;

                case 'help':
                    this.showHelp();
                    break;

                case 'exit':
                    await this.stop();
                    break;

                default:
                    log('알 수 없는 명령어. help를 입력하세요.', 'yellow');
            }
        } catch (error) {
            log(`명령어 실행 오류: ${error.message}`, 'red');
        }
    }

    // 포지션 조회
    async showPosition(symbol) {
        const position = await this.api.getPosition(symbol);
        const price = await this.api.getCurrentPrice(symbol);

        if (position && price) {
            log(`=== ${symbol} 포지션 현황 ===`, 'cyan');
            log(`포지션 크기: ${position.size} ${symbol}`, 'blue');
            log(`평균 진입가: $${position.avgPrice || 'N/A'}`, 'blue');
            log(`현재 가격: $${price}`, 'blue');
            
            if (position.unrealizedPnl) {
                const pnlColor = position.unrealizedPnl > 0 ? 'green' : 'red';
                log(`미실현 PnL: $${position.unrealizedPnl}`, pnlColor);
            }
        } else {
            log(`${symbol} 포지션 없음`, 'yellow');
        }
    }

    // 주문 현황 조회
    async showOrders() {
        const orders = await this.api.getOpenOrders();
        
        if (orders && orders.length > 0) {
            log('=== 열린 주문 현황 ===', 'cyan');
            orders.forEach((order, index) => {
                log(`${index + 1}. ${order.symbol} ${order.side} $${order.price} x ${order.amount}`, 'blue');
            });
        } else {
            log('열린 주문 없음', 'yellow');
        }
    }

    // 계좌 잔고 조회
    async showBalance() {
        const account = await this.api.getAccountInfo();
        
        if (account) {
            log('=== 계좌 잔고 ===', 'cyan');
            log(`총 잔고: $${account.totalBalance || 'N/A'}`, 'blue');
            log(`사용 가능: $${account.availableBalance || 'N/A'}`, 'blue');
            log(`마진: $${account.marginBalance || 'N/A'}`, 'blue');
        } else {
            log('계좌 정보 조회 실패', 'red');
        }
    }

    // 포지션 모니터링
    async monitorPositions() {
        if (!this.isRunning) return;

        log('포지션 모니터링 중...', 'blue');
        
        for (const [key, strategy] of this.strategy.activeStrategies) {
            const symbol = strategy.symbol;
            const position = await this.api.getPosition(symbol);
            
            if (position && position.unrealizedPnl) {
                const pnlPercent = (position.unrealizedPnl / position.notional) * 100;
                
                // 긴급 손절 체크
                if (pnlPercent <= -config.trading.emergencyStopLoss * 100) {
                    log(`긴급 손절 발동: ${symbol} ${pnlPercent.toFixed(2)}%`, 'red');
                    await this.strategy.stopAllStrategies(symbol);
                }
            }
        }
    }

    // 봇 종료
    async stop() {
        log('EdgeX 자동매매 봇 종료 중...', 'yellow');
        this.isRunning = false;
        
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        
        this.rl.close();
        log('봇이 종료되었습니다.', 'green');
        process.exit(0);
    }
}

// 봇 실행
if (require.main === module) {
    const bot = new EdgeXTradingBot();
    
    // 종료 신호 처리
    process.on('SIGINT', async () => {
        await bot.stop();
    });
    
    // 에러 처리
    process.on('unhandledRejection', (error) => {
        log(`처리되지 않은 오류: ${error.message}`, 'red');
    });
    
    bot.start().catch(error => {
        log(`봇 시작 실패: ${error.message}`, 'red');
        process.exit(1);
    });
}

module.exports = { EdgeXTradingBot, EdgeXAPI, TradingStrategy };