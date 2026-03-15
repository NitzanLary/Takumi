"""IBI Spark API endpoint definitions."""

BASE_URL = "https://sparkibi.ordernet.co.il"
ACCOUNT_KEY = "ACC_000-118390"

# Authentication
AUTHENTICATE_AUTH0 = "/api/Auth/AuthenticateAuth0"
GET_AUTH_DATA = "/api/Auth/GetAuthData"

# Data endpoints
GET_ACCOUNT_TRANSACTIONS = "/api/Account/GetAccountTransactions"
GET_NEW_ACCOUNT_TRANSACTIONS = "/api/Account/GetNewAccountTransactions"
GET_ACCOUNT_SECURITIES = "/api/Account/GetAccountSecurities"
GET_ACCOUNT_DAILY_YIELDS = "/api/Account/GetAccountDailyYields"
GET_ACCOUNT_MONTHLY_YIELDS = "/api/Account/GetAccountMonthlyYields"
GET_HOLDINGS = "/api/Account/GetHoldings"
GET_USER_DATA = "/api/UserPersonalization/GetUserData"
GET_STATIC_DATA = "/api/DataProvider/GetStaticData"
