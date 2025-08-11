import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.handler.*;
import burp.api.montoya.http.message.HttpHeader;
import burp.api.montoya.http.message.MimeType;
import burp.api.montoya.http.message.requests.HttpRequest;
import burp.api.montoya.logging.Logging;
import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;

public class CustomHTTPHandler implements HttpHandler {
    MontoyaApi api;
    Logging logging;
    JSLinkProcessor jsLinkProcessor;
    ExtractInlineScripts extractInlineScripts;
    ExtractAttributeScripts extractAttributeScripts;

    public CustomHTTPHandler(MontoyaApi api) {
        this.api = api;
        this.logging = api.logging();
        this.jsLinkProcessor = new JSLinkProcessor(api);
        this.extractInlineScripts = new ExtractInlineScripts(api);
        this.extractAttributeScripts = new ExtractAttributeScripts(api);
    }

    @Override
    public RequestToBeSentAction handleHttpRequestToBeSent(HttpRequestToBeSent httpRequestToBeSent) {
        if (!UI.isExtensionEnabled) {
            return RequestToBeSentAction.continueWith(httpRequestToBeSent);
        }

        if (UI.inScopeOnlyEnabled) {
            if (!httpRequestToBeSent.isInScope()) {
                return RequestToBeSentAction.continueWith(httpRequestToBeSent); // skip out-of-scope
            }
        }

        // Remove cache-related headers
        HttpRequest modifiedRequest = httpRequestToBeSent
                .withRemovedHeader("If-None-Match")
                .withRemovedHeader("If-Modified-Since")
                .withRemovedHeader("Cache-Control")
                .withRemovedHeader("If-Unmodified-Since")
                .withRemovedHeader("ETag");

        return RequestToBeSentAction.continueWith(modifiedRequest);
    }

    @Override
    public ResponseReceivedAction handleHttpResponseReceived(HttpResponseReceived httpResponseReceived) {
        HttpRequest request = httpResponseReceived.initiatingRequest();

        if (!UI.isExtensionEnabled) {
            return ResponseReceivedAction.continueWith(httpResponseReceived);
        }

        if (UI.inScopeOnlyEnabled) {
            if (!request.isInScope()) {
                return ResponseReceivedAction.continueWith(httpResponseReceived); // skip out-of-scope
            }
        }

        MimeType mimeType = httpResponseReceived.statedMimeType();
        String url = request.url();
        List<HttpHeader> headers = request.headers();
        String path = request.pathWithoutQuery().toLowerCase();
        String body = httpResponseReceived.bodyToString();
        URI uri = null;
        try {
            uri = new URI(request.url());
        } catch (URISyntaxException e) {
            throw new RuntimeException(e);
        }

        if (mimeType == MimeType.HTML) {
            if (isTrulyHtml(body)) {
                extractInlineScripts.saveInlineScripts(body, uri);
                extractAttributeScripts.extractAndSave(body, uri);
            }
        }

        boolean isJsByExtension = path.endsWith(".js") || path.endsWith(".ts");
        boolean isJsByContentType = mimeType == MimeType.SCRIPT;

        if (isJsByExtension || isJsByContentType) {
            jsLinkProcessor.process(body, url, headers);
        }

        return ResponseReceivedAction.continueWith(httpResponseReceived);
    }

    private boolean isTrulyHtml(String body) {
        return isLikelyHtml(body) && !isJson(body);
    }

    private boolean isLikelyHtml(String body) {
        if (body == null || body.trim().isEmpty()) {
            return false;
        }

        String lower = body.toLowerCase();

        return lower.contains("<!doctype") ||
                lower.contains("<html") ||
                lower.contains("<head") ||
                lower.contains("<body") ||
                lower.contains("<script");
    }

    private boolean isJson(String body) {
        try {
            JsonParser.parseString(body);
            return true;
        } catch (JsonSyntaxException e) {
            return false;
        }
    }
}
