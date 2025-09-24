# EdgeX 자동매매 봇 (EdgeX Trading Bot)

본 프로젝트는 EdgeX 거래소의 API를 활용하여 다양한 자동매매 전략을 수행할 수 있는 Node.js 기반의 트레이딩 봇입니다. 콘솔 인터페이스를 통해 간단한 명령어로 여러 전략을 실행하고 관리할 수 있습니다.

**⚠️ 경고: 본 봇은 실제 자산을 거래할 수 있습니다. 모든 투자의 책임은 사용자 본인에게 있습니다. 실제 자금을 투입하기 전에 반드시 소액으로 충분한 테스트를 거치시기 바랍니다. 개발자는 이 봇의 사용으로 인해 발생하는 어떠한 금전적 손실에 대해서도 책임지지 않습니다.**

---

## 주요 기능

-   **다양한 매매 전략 지원**
    -   **그리드 트레이딩 (Grid Trading):** 설정된 가격을 중심으로 격자 형태의 지정가 주문을 배치합니다.
    -   **DCA (Dollar-Cost Averaging):** 가격이 하락할 때마다 점진적으로 추가 매수하여 평균 단가를 낮춥니다.
    -   **스캘핑 (Scalping):** 빠른 시장가 진입 후 작은 수익/손실 구간에서 포지션을 종료합니다.
    -   **추세 추종 (Trend Following):** 간단한 추세 판단 로직에 따라 시장가 주문을 실행합니다.
-   **실시간 계좌 관리**
    -   계좌 잔고 조회
    -   현재 포지션 현황 조회
    -   미체결 주문 내역 조회
-   **전략 관리**
    -   특정 심볼에 대한 모든 활성 전략 및 주문 일괄 중지
    -   현재 실행 중인 전략 상태 확인
-   **안전 기능**
    -   긴급 손절: 설정된 손실률 도달 시 자동으로 포지션 종료

---

## 사전 준비

-   [Node.js](https://nodejs.org/) (v14 이상 권장)
-   npm (Node.js 설치 시 함께 설치됨)
-   EdgeX 거래소 계정 및 API Key

---

## 설치 방법

1.  **프로젝트 클론**
    ```bash
    git clone https://github.com/DuckLak/edgex-trading-bot.git
    cd edgex-trading-bot
    ```

2.  **필요한 라이브러리 설치**
    ```bash
    npm install
    ```
    (필요 라이브러리: `node-fetch`, `crypto`)

---

## 설정 방법

봇을 실행하기 전에 `edgex-trading-bot.js` 파일 상단의 `config` 객체를 수정해야 합니다.

```javascript
// 설정 파일
const config = {
    edgex: {
        apiKey: 'YOUR_API_KEY_HERE',     // 1. 여기에 발급받은 API Key를 입력하세요.
        secretKey: 'YOUR_SECRET_KEY_HERE', // 2. 여기에 발급받은 Secret Key를 입력하세요.
        publicUrl: 'https://pro.edgex.exchange/api/v1/public',
        privateUrl: 'https://pro.edgex.exchange/api/v1/private'
    },
    trading: {
        defaultLeverage: 3,
        maxPositionSize: 10,
        emergencyStopLoss: 0.05 // 5% 긴급 손절
    }
};
```

### **🚨 중요: API 키 보안 주의사항 🚨**

**절대로 API Key와 Secret Key가 포함된 코드를 GitHub와 같은 공개된 장소에 업로드하지 마세요!**

이를 방지하기 위해 프로젝트 폴더에 `.gitignore` 파일을 만들고 아래 내용을 추가하는 것을 강력히 권장합니다.

**`.gitignore` 파일 예시:**
```
# Node.js
node_modules
npm-debug.log

# 민감한 정보
.env
config.js
```

보안을 강화하려면 API 키를 별도의 파일(예: `config.js`)이나 환경 변수(`.env` 파일)로 분리하여 관리하는 것이 좋습니다.

---

## 사용법

1.  **봇 실행**
    터미널에서 아래 명령어를 입력하여 봇을 시작합니다.
    ```bash
    node edgex-trading-bot.js
    ```

2.  **명령어 사용**
    봇이 실행되면 콘솔에 명령어를 입력하여 봇을 제어할 수 있습니다.

    -   `help`: 모든 명령어 목록을 표시합니다.
    -   `grid [심볼] [중심가] [간격] [수량]`: 그리드 트레이딩 전략을 시작합니다.
        -   `예: grid BTC 60000 200 0.01`
    -   `dca [심볼] [목표가] [단계%] [기본수량]`: DCA(물타기) 전략을 시작합니다.
        -   `예: dca ETH 4000 5 0.1`
    -   `scalp [심볼] [수익%] [손절%] [수량]`: 스캘핑 전략을 시작합니다.
        -   `예: scalp SOL 1.5 0.8 10`
    -   `trend [심볼] [수량] [레버리지]`: 추세 추종 전략을 시작합니다.
        -   `예: trend BTC 0.05 5`
    -   `stop [심볼]`: 해당 심볼의 모든 전략을 중지하고 열린 주문을 취소합니다.
        -   `예: stop BTC`
    -   `pos [심볼]`: 해당 심볼의 현재 포지션 정보를 조회합니다.
        -   `예: pos ETH`
    -   `orders`: 현재 열려있는 모든 주문을 조회합니다.
    -   `balance`: 계좌의 총 잔고 및 사용 가능 잔고를 조회합니다.
    -   `status`: 현재 활성화된 모든 전략의 목록을 표시합니다.
    -   `exit`: 봇을 안전하게 종료합니다.
