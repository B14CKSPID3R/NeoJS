import java.awt.Toolkit;
import java.util.List;
import java.awt.datatransfer.Clipboard;
import java.awt.datatransfer.StringSelection;
import java.io.*;
import java.net.URI;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

public class Helper {

    public static String extractPageName(URI uri) {
        String path = uri.getPath(); // e.g., /some/page.html or /index
        if (path == null || path.isEmpty() || path.equals("/")) {
            return "root";
        }
        // Take last part of the path (after last '/')
        String lastSegment = path.substring(path.lastIndexOf('/') + 1);
        if (lastSegment.isEmpty()) {
            return "index";
        }
        // Remove file extension if exists
        int dotIndex = lastSegment.lastIndexOf('.');
        if (dotIndex > 0) {
            lastSegment = lastSegment.substring(0, dotIndex);
        }
        // sanitize filename (remove special chars)
        return lastSegment.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    public static String md5Hash(String content) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] digest = md.digest(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : digest) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    public static String normalizeUrl(URI uri) {
        StringBuilder cleanedUrl = new StringBuilder();
        cleanedUrl.append(uri.getScheme()).append("://").append(uri.getHost());

        int port = uri.getPort();
        if (port != -1 && port != getDefaultPort(uri.getScheme())) {
            cleanedUrl.append(":").append(port);
        }

        cleanedUrl.append(uri.getPath());
        return cleanedUrl.toString();
    }

    public static int getDefaultPort(String scheme) {
        return switch (scheme.toLowerCase()) {
            case "http" -> 80;
            case "https" -> 443;
            default -> -1;
        };
    }

    public static Path getHierarchicalPath(URI uri) throws IOException {
        String host = uri.getHost(); // e.g., example.com
        String rawPath = uri.getPath(); // e.g., /assets/js/app.js

        if (rawPath == null || rawPath.isEmpty() || rawPath.endsWith("/")) {
            rawPath += "index.js"; // Default name for folder-only paths
        }

        return Main.DEFAULT_BASE_PATH.resolve(Paths.get(host + rawPath.replace("/", FileSystems.getDefault().getSeparator())));
    }

    public static boolean deleteDirectoryRecursively(File dir) {
        if (dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (!deleteDirectoryRecursively(file)) {
                        return false;
                    }
                }
            }
        }
        return dir.delete();
    }

    public static byte[] decompressGzip(byte[] data) throws IOException {
        try (GZIPInputStream gis = new GZIPInputStream(new ByteArrayInputStream(data));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            gis.transferTo(out);
            return out.toByteArray();
        }
    }

    public static byte[] decompressDeflate(byte[] data) throws IOException {
        try (InflaterInputStream iis = new InflaterInputStream(new ByteArrayInputStream(data));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            iis.transferTo(out);
            return out.toByteArray();
        }
    }

    // Methods to clear lists
    public static void clearEndpoints() {
        UI.endpointsModel.clear();
    }

    public static void clearParameters() {
        UI.parametersModel.clear();
    }

    public static void clearSourceMaps() {
        UI.sourceMapsModel.clear();
    }

    public void clearAll() {
        clearEndpoints();
        clearParameters();
        clearSourceMaps();
    }

    // Method to check if lists contain duplicates before adding
    public static void addEndpointIfNotExists(String endpoint) {
        if (endpoint != null && !endpoint.trim().isEmpty()) {
            String trimmed = endpoint.trim();
            if (!UI.endpointsModel.contains(trimmed)) {
                UI.endpointsModel.addElement(trimmed);
            }
        }
    }

    public static void addParameterIfNotExists(String parameter) {
        if (parameter != null && !parameter.trim().isEmpty()) {
            String trimmed = parameter.trim();
            if (!UI.parametersModel.contains(trimmed)) {
                UI.parametersModel.addElement(trimmed);
            }
        }
    }

    public static void addSourceMapIfNotExists(String sourceMap) {
        if (sourceMap != null && !sourceMap.trim().isEmpty()) {
            String trimmed = sourceMap.trim();
            if (!UI.sourceMapsModel.contains(trimmed)) {
                UI.sourceMapsModel.addElement(trimmed);
            }
        }
    }

    public static void copyToClipboard(String text) {
        try {
            StringSelection selection = new StringSelection(text);
            Clipboard clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
            clipboard.setContents(selection, null);
        } catch (Exception e) {
            // Handle clipboard access issues silently
        }
    }

    public static String runCommandWithTarget(String command, File target) throws IOException, InterruptedException {
        String[] cmd;
        String os = System.getProperty("os.name").toLowerCase();
        if (os.contains("win")) {
            cmd = new String[]{"cmd.exe", "/c", command};
        } else {
            cmd = new String[]{"/bin/sh", "-c", command};
        }

        ProcessBuilder pb = new ProcessBuilder(cmd);
        if (target.isDirectory()) {
            pb.directory(target);
        }
        pb.redirectErrorStream(true);

        Process process = pb.start();
        StringBuilder output = new StringBuilder();

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append(System.lineSeparator());
            }
        }

        int exitCode = process.waitFor();
        if (exitCode != 0) {
            throw new RuntimeException("Command exited with code: " + exitCode);
        }

        return output.toString();
    }

    public static void runJSEndpoints(File target) throws IOException, InterruptedException {
        String command = "node --no-warnings " +
                Paths.get(Main.DEFAULT_BASE_PATH.getParent().toString(), "plugins", "JSEndpoints", "jsendpoints.js") +
                " --file \"" + target.getAbsolutePath() + "\"";

        String output = Helper.runCommandWithTarget(command, target).trim();

        // Parse output as JSON array using Gson
        Gson gson = new Gson();
        List<String> endpoints = gson.fromJson(output, new TypeToken<List<String>>() {}.getType());

        for (String url : endpoints) {
            addEndpointIfNotExists(url);
        }
    }

    public static void runJSParams(File target) throws IOException, InterruptedException {
        String command = "node --no-warnings " +
                Paths.get(Main.DEFAULT_BASE_PATH.getParent().toString(), "plugins", "JSParams", "jsparams.js") +
                " --file \"" + target.getAbsolutePath() + "\"";

        String output = Helper.runCommandWithTarget(command, target).trim();

        // Parse output as JSON array using Gson
        Gson gson = new Gson();
        List<String> endpoints = gson.fromJson(output, new TypeToken<List<String>>() {}.getType());

        for (String url : endpoints) {
            addParameterIfNotExists(url);
        }
    }
}
