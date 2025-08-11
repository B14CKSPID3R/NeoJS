import burp.api.montoya.MontoyaApi;
import burp.api.montoya.logging.Logging;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

import java.net.URI;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

public class ExtractAttributeScripts {

    private final Logging logging;
    private final Set<String> seenAttributeHashes = ConcurrentHashMap.newKeySet();

    public ExtractAttributeScripts(MontoyaApi api) {
        this.logging = api.logging();
    }

    public void extractAndSave(String html, URI pageUri) {
        try {
            Document doc = Jsoup.parse(html);
            Set<String> foundJsSnippets = new LinkedHashSet<>();

            for (Element element : doc.getAllElements()) {
                for (org.jsoup.nodes.Attribute attr : element.attributes()) {
                    String attrName = attr.getKey().toLowerCase(Locale.ROOT);
                    String value = attr.getValue().trim();

                    if (isPotentialJS(attrName, value)) {
                        String extracted = extractScriptValue(attrName, value);
                        if (!extracted.isEmpty()) {
                            foundJsSnippets.add(extracted);
                        }
                    }
                }
            }

            if (foundJsSnippets.isEmpty()) {
                return;
            }

            String combinedJs = String.join("\n\n", foundJsSnippets);
            String hash = Helper.md5Hash(combinedJs);

            if (!seenAttributeHashes.add(hash)) {
                return;
            }

            String pageName = Helper.extractPageName(pageUri);
            String randomPart = Long.toHexString(System.currentTimeMillis()) + "-" + ThreadLocalRandom.current().nextInt(1000, 9999);
            String filename = String.format("attribute-%s-%s.js", pageName, randomPart);

            Path domainFolder = Main.DEFAULT_BASE_PATH.resolve(pageUri.getHost());
            Files.createDirectories(domainFolder);
            Path savePath = domainFolder.resolve(filename);

            Files.writeString(savePath, combinedJs, StandardOpenOption.CREATE_NEW);
            UI.loadDomainFolders();
            
            logging.logToOutput("[+] Saved attribute JS to: " + savePath + " (MD5: " + hash + ")");
        } catch (Exception e) {
            logging.logToError("[-] Error extracting attribute scripts: " + e.getMessage());
        }
    }

    private boolean isPotentialJS(String attrName, String value) {
        // Match: on* attributes or href/src starting with "javascript:"
        return attrName.matches("^on[a-zA-Z]+") || (
                (attrName.equals("href") || attrName.equals("src")) &&
                        value.toLowerCase(Locale.ROOT).startsWith("javascript:")
        );
    }

    private String extractScriptValue(String attrName, String value) {
        if ((attrName.equals("href") || attrName.equals("src")) &&
                value.toLowerCase(Locale.ROOT).startsWith("javascript:")) {
            return value.substring("javascript:".length());
        }
        return value;
    }
}
