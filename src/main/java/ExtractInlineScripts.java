import burp.api.montoya.MontoyaApi;
import burp.api.montoya.logging.Logging;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

public class ExtractInlineScripts {
    private final Set<String> seenInlineScriptHashes = ConcurrentHashMap.newKeySet();
    Logging logging;

    public ExtractInlineScripts(MontoyaApi api) {
        this.logging = api.logging();
    }

    public void saveInlineScripts(String html, URI pageUri) {
        try {
            Document doc = Jsoup.parse(html);
            Elements inlineScripts = doc.select("script:not([src])"); // scripts without src attribute

            String domain = pageUri.getHost();
            Path domainFolder = Main.DEFAULT_BASE_PATH.resolve(domain);
            Files.createDirectories(domainFolder);

            for (Element script : inlineScripts) {
                String scriptContent = script.data(); // get inside <script> ... </script>

                if (scriptContent.trim().isEmpty()) {
                    continue; // skip empty scripts
                }

                String md5 = Helper.md5Hash(scriptContent);

                // Check if this MD5 is already saved (avoid duplicates)
                if (seenInlineScriptHashes.contains(md5)) {
//                    logging.logToOutput("[!] Skipping duplicate inline script (MD5): " + md5);
                    continue;
                }

                seenInlineScriptHashes.add(md5);

                // Generate file name: inline-{page_name}-{random}.js
                String pageName = Helper.extractPageName(pageUri);
                String randomSuffix = Long.toHexString(System.currentTimeMillis()) + "-" + ThreadLocalRandom.current().nextInt(1000, 9999);
                String filename = String.format("inline-%s-%s.js", pageName, randomSuffix);

                Path savePath = domainFolder.resolve(filename);

                Files.writeString(savePath, scriptContent, StandardOpenOption.CREATE_NEW);
                UI.loadDomainFolders();

                if (UI.isEndpointsEnabled) {
                    Helper.runJSEndpoints(savePath.toFile());
                }

                if (UI.isParamsEnabled) {
                    Helper.runJSParams(savePath.toFile());
                }

                logging.logToOutput("[+] Saved inline script: " + savePath + " (MD5: " + md5 + ")");
            }
        } catch (Exception e) {
            logging.logToError("[-] Error saving inline scripts for " + pageUri + ": " + e.getMessage());
        }
    }

}
