# NeoJS 🔍

<div align="center">
  <img src="banner.jpg" alt="NeoJS Banner" width="100%"><br>
</div>

<div align="center">

[![Java](https://img.shields.io/badge/Java-21-orange.svg)](https://openjdk.java.net/)
[![Gradle](https://img.shields.io/badge/Gradle-8.0+-green.svg)](https://gradle.org/)
[![Burp Suite](https://img.shields.io/badge/Burp%20Suite-Extension-blue.svg)](https://portswigger.net/burp)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Advanced JavaScript Analysis & Extraction Tool for Burp Suite**

</div>

---

## 🚀 Overview

NeoJS is a powerful Burp Suite extension designed for comprehensive JavaScript analysis, endpoint extraction, and automated request generation. It provides real-time JavaScript processing, parameter discovery, and intelligent request crafting capabilities for web application security testing.

## ✨ Key Features

### 🔍 **Real-time JavaScript Analysis**
- **Automatic JS Detection**: Identifies JavaScript files through HTTP responses and content-type analysis
- **Inline Script Extraction**: Extracts embedded JavaScript from HTML responses
- **Attribute Script Processing**: Analyzes event handlers and script attributes
- **Source Map Support**: Processes source maps for enhanced debugging information

### 🎯 **Endpoint Discovery**
- **Comprehensive Endpoint Extraction**: Finds API endpoints, AJAX calls, and dynamic URLs
- **Multiple Framework Support**: Detects endpoints from various JavaScript frameworks (Axios, Fetch, jQuery, etc.)
- **Pattern Recognition**: Identifies RESTful endpoints, GraphQL queries, and custom API calls
- **False Positive Filtering**: Advanced filtering to reduce noise and improve accuracy

### 📊 **Parameter Analysis**
- **URL Parameter Extraction**: Discovers query parameters from JavaScript code
- **GraphQL Variable Detection**: Identifies GraphQL variables and their types
- **Dynamic Parameter Analysis**: Finds parameters used in dynamic URL construction
- **Parameter Classification**: Categorizes parameters by usage patterns

### 🔧 **Automated Request Generation**
- **Intelligent Request Crafting**: Automatically generates HTTP requests from discovered endpoints
- **Multi-threaded Processing**: Concurrent request processing for improved performance
- **Proxy Integration**: Seamless integration with Burp Suite's proxy for request interception
- **Custom Headers Support**: Preserves and applies original request headers

### 🛠 **Advanced Tools**
- **Domain-based Analysis**: Organize and analyze JavaScript files by domain
- **Custom Tool Integration**: Extensible framework for custom analysis tools
- **Configuration Management**: Persistent settings and tool configurations
- **Real-time Logging**: Comprehensive logging for debugging and analysis

### 🎨 **User Interface**
- **Modern UI**: Clean, intuitive interface with dark/light theme support
- **Tabbed Interface**: Organized tabs for different analysis functions
- **Real-time Updates**: Live updates of discovered endpoints and parameters

## 🚀 Installation & Build

### Prerequisites

- **Java 21** or higher
- **Gradle 8.0+**
- **Burp Suite Professional** (2024.5+)
- **Node.js** (for plugins)

### Building the Project

1. **Clone the repository**
   ```bash
   git clone https://github.com/B14CK-SPID3R/NeoJS.git
   cd NeoJS
   ```

2. **Build the project**
   ```bash
   # On Windows
   build_plugins.bat
   gradlew.bat build
   
   # On Linux/macOS
   chmod +x ./build_plugins.sh
   ./build_plugins.sh
   ./gradlew build
   ```

3. **Install in Burp Suite**
   - Open Burp Suite Professional
   - Go to **Extensions** → **Extensions**
   - Click **Add** → **Extension**
   - Select **Java** as the extension type
   - Browse to `build/libs/NeoJS.jar`
   - Click **Next** and **Close**

## 📖 Usage

### Basic Usage

1. **Load the Extension**: Install NeoJS in Burp Suite
2. **Navigate to NeoJS Tab**: Find the "Neo JS" tab in Burp Suite
3. **Configure Settings**: Set up your analysis preferences
4. **Define your scope**: If you want to process in-scope javascript files
5. **Start Browsing**: Begin your web application testing (Clear your cache or use Burp Suite's browser to avoid caching issues)
6. **Review Results**: Run your favorite tools that you've added on Tools tab and check the Extractor tab for discovered endpoints/parameters/source map files

### Advanced Configuration

#### Analysis Settings
- **Enable/Disable Extension**: Toggle real-time analysis
- **In-Scope Only**: Process only in-scope requests
- **Worker Threads**: Configure concurrent processing (default: 4 workers)

#### Tool Configuration
- **Custom Tools**: Add your own analysis tools
- **Domain Organization**: Organize results by domain

### Plugin Usage (You can use them as standalone tools)

#### Endpoint Extraction
```bash
node JSEndpoints.js /path/to/javascript/dir
```

#### Parameter Analysis
```bash
node JSParameters.js /path/to/javascript/dir
```

#### Request Generation
```bash
node JSRequests.js --proxy http://127.0.0.1:8080 /path/to/javascript/dir
```

## 🔧 Configuration

### Extension Settings
**Windows:**
- **Base Path**: `%USERPROFILE%\.NeoJS`
- **Plugin Directory**: `%USERPROFILE%\.NeoJS\plugins\`
- **Configuration**: `%USERPROFILE%\.NeoJS\tools.json`

**Linux:**
- **Base Path**: `~/.NeoJS/files/`
- **Plugin Directory**: `~/.NeoJS/plugins/`
- **Configuration**: `~/.NeoJS/tools.json`

## 📊 Performance

- **Multi-threaded Processing**: Concurrent JavaScript analysis
- **Efficient Caching**: Prevents duplicate processing
- **Memory Optimization**: Optimized for large-scale analysis
- **Real-time Processing**: Minimal latency in request processing

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Made with ❤️ for the security community**

</div> 