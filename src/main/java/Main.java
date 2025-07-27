import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.logging.Logging;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class Main implements BurpExtension {
    MontoyaApi api;
    Logging logging;
    public static Path DEFAULT_BASE_PATH = Paths.get(System.getProperty("user.home"), ".NeoJS", "files");
    @Override
    public void initialize(MontoyaApi montoyaApi) {
        this.api = montoyaApi;
        this.logging = api.logging();
        montoyaApi.extension().setName("Neo JS");

        try {
            // 1. Create a directory for JS files in Burp's extension folder
            Path JSRequestPluginDir = Paths.get(System.getProperty("user.home"), ".NeoJS", "plugins", "JSRequests");
            Files.createDirectories(JSRequestPluginDir);

            Path JSEndpointsPluginDir = Paths.get(System.getProperty("user.home"), ".NeoJS", "plugins", "JSEndpoints");
            Files.createDirectories(JSEndpointsPluginDir);

            Path JSParamsPluginDir = Paths.get(System.getProperty("user.home"), ".NeoJS", "plugins", "JSParams");
            Files.createDirectories(JSParamsPluginDir);

            // 2. Extract bundled JS and package.json
            extractResource("neo.png", Paths.get(DEFAULT_BASE_PATH.getParent().toString(), "neo.png"));

            extractResource("/JSRequest/jsrequests.js", JSRequestPluginDir.resolve("jsrequests.js"));
            extractResource("/JSRequest/package.json", JSRequestPluginDir.resolve("package.json"));

            extractResource("/JSEndpoints/jsendpoints.js", JSEndpointsPluginDir.resolve("jsendpoints.js"));
            extractResource("/JSEndpoints/package.json", JSEndpointsPluginDir.resolve("package.json"));

            extractResource("/JSParams/jsparams.js", JSParamsPluginDir.resolve("jsparams.js"));
            extractResource("/JSParams/package.json", JSParamsPluginDir.resolve("package.json"));

            // 3. Log success
            api.logging().logToOutput("[+] Node.js files extracted to: " + JSRequestPluginDir);
            api.logging().logToOutput("[+] Node.js files extracted to: " + JSEndpointsPluginDir);
            api.logging().logToOutput("[+] Node.js files extracted to: " + JSParamsPluginDir);

        } catch (IOException e) {
            api.logging().logToError("[-] Failed to extract JS files: " + e.getMessage());
        }

        UI kissPanel = new UI(montoyaApi);
        montoyaApi.userInterface().registerSuiteTab("Neo JS", kissPanel);
        api.http().registerHttpHandler(new CustomHTTPHandler(montoyaApi));
        api.proxy().registerRequestHandler(new CustomProxyHandler());
    }

    private void extractResource(String resourcePath, Path targetPath) throws IOException {
        // If file exists, delete it first
        if (Files.exists(targetPath)) {
            Files.delete(targetPath);
        }

        try (InputStream is = getClass().getResourceAsStream(resourcePath)) {
            if (is == null) {
                throw new IOException("Resource not found: " + resourcePath);
            }
            Files.copy(is, targetPath);
        }
    }


}