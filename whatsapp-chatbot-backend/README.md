# WhatsApp Chatbot Backend using Bailey

## Overview

This project is a backend-only WhatsApp chatbot implemented in JavaScript using the Bailey library. It supports three user roles: bot, customer service (CS), and user. The bot and CS share the same WhatsApp account.

## Features

- Initial greeting with menu options.
- Menu navigation with submenus (Info -> PDRB).
- Bot-generated messages append "chat digenerate oleh bot".
- Menu to chat with CS, where CS takes over the conversation.
- CS can return control to bot by sending "terima kasih".
- Conversation ends after 2 minutes of user inactivity.
- All conversations are logged to a Google Spreadsheet.
- Detailed documentation and code comments for easy maintenance.

## Setup

### Prerequisites

- Node.js (v16 or higher recommended)
- A Google account with access to Google Sheets API
- WhatsApp account for bot and CS (same account)

### Installation

1. Clone the repository or copy the project files.

2. Install dependencies:

\`\`\`bash
npm install
\`\`\`

3. Set up Google Sheets API:

- Create a project in Google Cloud Console.
- Enable Google Sheets API.
- Create OAuth 2.0 credentials and download `credentials.json`.
- Generate `token.json` by running the Google OAuth flow (not included in this code).
- Share the Google Sheet with the service account email or your OAuth user.

4. Create a `.env` file in the project root with the following variables:

\`\`\`
SPREADSHEET_ID=your_google_sheet_id
SHEET_NAME=Sheet1
\`\`\`

Replace `your_google_sheet_id` with your actual Google Sheet ID.

### Running the Bot

Start the bot with:

\`\`\`bash
npm start
\`\`\`

On first run, a QR code will be displayed in the terminal. Scan it with your WhatsApp to authenticate.

## Conversation Flow

- When a user sends a message for the first time, the bot sends a greeting and main menu.
- User selects menu options by sending numbers:
  - 1: Info menu
  - 2: Chat with CS
  - 3: End conversation
- Info menu has options:
  - 1: PDRB (shows value 1 million)
  - 2: Back to main menu
- PDRB menu:
  - 1: Back to info menu
- When chatting with CS, bot replies "mohon tunggu sebentar." and CS takes over.
- CS sends "terima kasih" to return control to bot.
- If no user response for 2 minutes, conversation ends automatically.
- All messages are logged to Google Sheets with timestamp, sender, and message.

## Code Structure

- `index.js`: Main bot logic, WhatsApp connection, message handling, state management, Google Sheets logging.
- `package.json`: Project dependencies and scripts.
- `.env`: Environment variables for configuration.
- `auth_info.json`: Bailey authentication state (auto-generated).
- `credentials.json` and `token.json`: Google API credentials (not included).

## Notes

- This project only implements backend logic; no frontend UI.
- Ensure Google Sheets API credentials and tokens are correctly set up.
- The bot and CS share the same WhatsApp account; switching control is managed internally.
- Modify the code to extend menus or add features as needed.

## Troubleshooting

- If the bot disconnects, it will attempt to reconnect automatically.
- Check console logs for errors related to Google Sheets or WhatsApp connection.
- Ensure network connectivity for WhatsApp and Google API access.

## License

MIT License

---

For any questions or issues, please contact the developer.
