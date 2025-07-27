import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.HttpHeader;
import burp.api.montoya.logging.Logging;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.*;
import java.util.List;
import java.util.Set;
import java.util.concurrent.*;

public class JSUrlProcessor {

    private static class QueuedRequest {
        final String url;
        final List<HttpHeader> headers;

        QueuedRequest(String url, List<HttpHeader> headers) {
            this.url = url;
            this.headers = headers;
        }
    }

    private final Set<String> seenUrls = ConcurrentHashMap.newKeySet();
    private final Set<String> processedUrls = ConcurrentHashMap.newKeySet();
    private final BlockingQueue<QueuedRequest> queue = new LinkedBlockingQueue<>();
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    private final Logging logging;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public JSUrlProcessor(MontoyaApi api) {
        this.logging = api.logging();
        startWorkers();
    }

    public void addUrl(String fullUrl, List<HttpHeader> headers) {
        try {
            URI uri = new URI(fullUrl);
            String cleanedUrl = Helper.normalizeUrl(uri);

            if (seenUrls.add(cleanedUrl)) {
                queue.offer(new QueuedRequest(cleanedUrl, headers));
            }
        } catch (Exception e) {
            logging.logToError("[-] Invalid URL: " + fullUrl + " - " + e.getMessage());
        }
    }

    private void startWorkers() {
        Runnable worker = () -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    QueuedRequest req = queue.take();
                    if (processedUrls.add(req.url)) {
                        process(req);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    logging.logToOutput("[!] Worker interrupted.");
                }
            }
        };

        for (int i = 0; i < UI.numberOfWorkers; i++) {
            executor.submit(worker);
        }

        logging.logToOutput("[+] JSUrlProcessor started with " + UI.numberOfWorkers + " workers.");
    }

    private void process(QueuedRequest req) {
        try {
            URI uri = new URI(req.url);
            Path savePath = Helper.getHierarchicalPath(uri);

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(uri)
                    .GET()
                    .header("Accept-Encoding", "gzip, deflate");

            Set<String> restricted = Set.of(
                    "connection", "host", "content-length", "expect",
                    "upgrade", "transfer-encoding"
            );

            for (HttpHeader header : req.headers) {
                String name = header.name().toLowerCase();
                if (!restricted.contains(name)) {
                    builder.header(header.name(), header.value());
                }
            }

            HttpResponse<byte[]> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());

            if (response.statusCode() == 200) {
                byte[] body = response.body();
                String encoding = response.headers()
                        .firstValue("Content-Encoding")
                        .orElse("")
                        .toLowerCase();

                if ("gzip".equals(encoding)) {
                    body = Helper.decompressGzip(body);
                } else if ("deflate".equals(encoding)) {
                    body = Helper.decompressDeflate(body);
                }

                Files.createDirectories(savePath.getParent());
                Files.write(savePath, body, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
                UI.loadDomainFolders();

                if (UI.isEndpointsEnabled) {
                    Helper.runJSEndpoints(savePath.toFile());
                }

                if (UI.isParamsEnabled) {
                    Helper.runJSParams(savePath.toFile());
                }

                logging.logToOutput("[+] Saved to: " + savePath);

                // New: check for source map
                if (UI.isSourceMapsEnabled){
                    checkAndSaveSourceMap(req);
                }

            } else {
                logging.logToError("[-] Failed to download: " + req.url + " - Status code: " + response.statusCode());
            }
        } catch (Exception e) {
            logging.logToError("[-] Failed to download/save: " + req.url + " - " + e.getMessage());
        }
    }

    private void checkAndSaveSourceMap(QueuedRequest req) {
        try {
            String mapUrl = req.url + ".map";
            URI mapUri = new URI(mapUrl);
            Path mapSavePath = Helper.getHierarchicalPath(mapUri);

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(mapUri)
                    .GET()
                    .header("Accept-Encoding", "gzip, deflate");

            Set<String> restricted = Set.of(
                    "connection", "host", "content-length", "expect",
                    "upgrade", "transfer-encoding"
            );

            for (HttpHeader header : req.headers) {
                String name = header.name().toLowerCase();
                if (!restricted.contains(name)) {
                    builder.header(header.name(), header.value());
                }
            }

            HttpResponse<byte[]> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());

            if (response.statusCode() == 200) {
                byte[] body = response.body();
                String encoding = response.headers()
                        .firstValue("Content-Encoding")
                        .orElse("")
                        .toLowerCase();

                if ("gzip".equals(encoding)) {
                    body = Helper.decompressGzip(body);
                } else if ("deflate".equals(encoding)) {
                    body = Helper.decompressDeflate(body);
                }

                Files.createDirectories(mapSavePath.getParent());
                Files.write(mapSavePath, body, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
                logging.logToOutput("[+] Source map saved: " + mapSavePath);

                Helper.addSourceMapIfNotExists(mapUrl);  // <--- pass full URL here
            } else {
                logging.logToOutput("[-] No source map at: " + mapUrl + " - Status code: " + response.statusCode());
            }

        } catch (Exception e) {
            logging.logToError("[-] Error downloading source map for " + req.url + " - " + e.getMessage());
        }
    }

    public void shutdown() {
        executor.shutdownNow();
        logging.logToOutput("[-] JSUrlProcessor shut down.");
    }
}
