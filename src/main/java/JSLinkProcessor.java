import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.HttpHeader;
import burp.api.montoya.logging.Logging;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.*;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.swing.SwingUtilities;

public class JSLinkProcessor {

    private record QueuedTask(String url, String body, List<HttpHeader> headers) {}

    private final Set<String> seenUrls = ConcurrentHashMap.newKeySet();
    private final Set<String> processedUrls = ConcurrentHashMap.newKeySet();
    private final BlockingQueue<QueuedTask> queue = new LinkedBlockingQueue<>();
    private final ExecutorService workerExecutor;
    private final Logging logging;
    private final HttpClient httpClient;
    private final AtomicBoolean isShuttingDown = new AtomicBoolean(false);

    public JSLinkProcessor(MontoyaApi api) {
        this.logging = api.logging();
        this.httpClient = HttpClient.newHttpClient();
        this.workerExecutor = Executors.newFixedThreadPool(UI.numberOfWorkers);

        // Start worker threads
        for (int i = 0; i < UI.numberOfWorkers; i++) {
            workerExecutor.submit(this::workerLoop);
        }

        // Handle Burp unload event
        api.extension().registerUnloadingHandler(this::shutdown);
    }

    // Enqueue a JS body for processing by worker threads
    public void enqueue(String url, String body, List<HttpHeader> headers) {
        if (isShuttingDown.get()) return;
        if (seenUrls.add(url)) {
            queue.offer(new QueuedTask(url, body, headers));
        }
    }

    // Worker loop: consume queued JS bodies and process them
    private void workerLoop() {
        while (!isShuttingDown.get()) {
            try {
                QueuedTask task = queue.poll(500, TimeUnit.MILLISECONDS);
                if (task == null) continue;

                if (!processedUrls.add(task.url())) continue;

                performProcessing(task.body(), task.url(), task.headers());

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                logging.logToError("Worker error: " + e.getMessage());
            }
        }
    }

    // No fetch needed; bodies are supplied by Burp handler

    // Public API: enqueue body for worker processing (non-blocking)
    public void process(String body, String url, List<HttpHeader> headers) {
        enqueue(url, body, headers);
    }

    /**
     * Actual processing logic executed in a worker thread.
     */
    private void performProcessing(String body, String url, List<HttpHeader> headers) throws IOException, InterruptedException {
        try {
            URI uri = new URI(url);
            Path savePath = Helper.getHierarchicalPath(uri);

            Files.createDirectories(savePath.getParent());
            Files.writeString(savePath, body, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            SwingUtilities.invokeLater(UI::loadDomainFolders);

            logging.logToOutput("[+] Saved to: " + savePath);

            if (UI.isSourceMapsEnabled) {
                checkSourceMapExists(url, headers);
            }
        } catch (URISyntaxException e) {
            throw new RuntimeException(e);
        }
    }

    // Check if source map exists using a lightweight HEAD request
    private void checkSourceMapExists(String url, List<HttpHeader> headers) {
        if (isShuttingDown.get()) return;

        try {
            String mapUrl = getSourceMapUrl(url);
            URI mapUri = new URI(mapUrl);

            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(mapUri)
                    .method("GET", HttpRequest.BodyPublishers.noBody()); // GET to get Content-Type

            Set<String> restricted = Set.of(
                    "connection", "host", "content-length", "expect",
                    "upgrade", "transfer-encoding"
            );

            for (HttpHeader header : headers) {
                String name = header.name().toLowerCase();
                if (!restricted.contains(name)) {
                    builder.header(header.name(), header.value());
                }
            }

            HttpResponse<Void> response = httpClient.send(
                    builder.build(),
                    HttpResponse.BodyHandlers.discarding()
            );

            if (response.statusCode() == 200) {
                Optional<String> contentTypeOpt = response.headers()
                        .firstValue("Content-Type");

                if (contentTypeOpt.isPresent()) {
                    String contentType = contentTypeOpt.get().toLowerCase();
                    if (contentType.contains("application/javascript") || contentType.contains("text/javascript")) {
                        Helper.addSourceMapIfNotExists(mapUrl);
                        logging.logToOutput("[+] Source map exists and is JS: " + mapUrl);
                    } else {
                        logging.logToOutput("[-] Found file at " + mapUrl + " but not JS: " + contentType);
                    }
                } else {
                    logging.logToOutput("[-] No Content-Type header for: " + mapUrl);
                }
            } else {
                logging.logToOutput("[-] No source map at: " + mapUrl + " - Status: " + response.statusCode());
            }
        } catch (Exception e) {
            if (!isShuttingDown.get()) {
                logging.logToError("[-] Error checking source map for " + url + " - " + e.getMessage());
            }
        }
    }

    // Utility method to insert .map correctly
    private String getSourceMapUrl(String url) throws URISyntaxException {
        URI uri = new URI(url);
        String path = uri.getPath(); // e.g., /1.js
        int lastDot = path.lastIndexOf('.');
        if (lastDot == -1) {
            path = path + ".map";
        } else {
            path = path.substring(0, lastDot + 3) + ".map"; // +3 for .js
        }

        // rebuild URI with original query and fragment
        URI mapUri = new URI(
                uri.getScheme(),
                uri.getAuthority(),
                path,
                uri.getQuery(),
                uri.getFragment()
        );
        return mapUri.toString();
    }


    /**
     * Stops workers and clears queue.
     */
    public void shutdown() {
        if (isShuttingDown.getAndSet(true)) {
            return;
        }

        logging.logToOutput("[*] Starting graceful shutdown...");
        queue.clear();

        workerExecutor.shutdownNow();
        try {
            if (!workerExecutor.awaitTermination(5, TimeUnit.SECONDS)) {
                logging.logToError("[!] Some tasks didn't complete during shutdown");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logging.logToError("[!] Shutdown interrupted: " + e.getMessage());
        }

        logging.logToOutput("[-] JSUrlProcessor shut down completely.");
    }
}