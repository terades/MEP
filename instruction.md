# Instructions to Run the Application

This document provides instructions on how to run the "Modern BVBS Korb Generator" application locally on your machine.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js**: This application uses a Node.js package to serve the files. You can download and install Node.js from the official website: [https://nodejs.org/](https://nodejs.org/)

## Running the Application

To run the application, follow these steps:

1. **Open a terminal or command prompt.**

2. **Navigate to the root directory of the project.** This is the directory where the `index.html` and `package.json` files are located.

3. **Install dependencies.** Install the required Node.js packages (Express and the Azure Service Bus client) by running:

   ```bash
   npm install
   ```

4. **Start the application.** Use the built-in Node.js server defined in `package.json`:

   ```bash
   npm start
   ```

5. **Access the application in your browser.** Once the server is running, it will provide you with a local URL. The default URL is:

   [http://localhost:3000](http://localhost:3000)

   Open this URL in your web browser to view and use the application.

## Stopping the Application

To stop the application, go back to your terminal or command prompt and press `Ctrl + C`.
