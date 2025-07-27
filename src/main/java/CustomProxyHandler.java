import burp.api.montoya.proxy.http.InterceptedRequest;
import burp.api.montoya.proxy.http.ProxyRequestHandler;
import burp.api.montoya.proxy.http.ProxyRequestReceivedAction;
import burp.api.montoya.proxy.http.ProxyRequestToBeSentAction;

import static burp.api.montoya.core.HighlightColor.ORANGE;

class CustomProxyHandler implements ProxyRequestHandler {
    @Override
    public ProxyRequestReceivedAction handleRequestReceived(InterceptedRequest interceptedRequest) {
        //Drop all post requests
        if (interceptedRequest.hasHeader("x-neo-js")){
            interceptedRequest.annotations().setHighlightColor(ORANGE);
            interceptedRequest.annotations().setNotes("Neo-JS Requests");
            interceptedRequest.withRemovedHeader("x-neo-js");
            return ProxyRequestReceivedAction.drop();
        }
        //Intercept all other requests
        return ProxyRequestReceivedAction.continueWith(interceptedRequest);
    }

    @Override
    public ProxyRequestToBeSentAction handleRequestToBeSent(InterceptedRequest interceptedRequest) {
        //Do nothing with the user modified request, continue as normal.
        return ProxyRequestToBeSentAction.continueWith(interceptedRequest);
    }
}
