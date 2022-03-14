// deno-fmt-ignore-file
// deno-lint-ignore-file
// This code was bundled using `deno bundle` and it's not recommended to edit it manually

function delay(ms, options = {}) {
    const { signal  } = options;
    if (signal?.aborted) {
        return Promise.reject(new DOMException("Delay was aborted.", "AbortError"));
    }
    return new Promise((resolve, reject)=>{
        const abort = ()=>{
            clearTimeout(i);
            reject(new DOMException("Delay was aborted.", "AbortError"));
        };
        const done = ()=>{
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const i = setTimeout(done, ms);
        signal?.addEventListener("abort", abort, {
            once: true
        });
    });
}
const ERROR_SERVER_CLOSED = "Server closed";
const INITIAL_ACCEPT_BACKOFF_DELAY = 5;
const MAX_ACCEPT_BACKOFF_DELAY = 1000;
class Server {
    #port;
    #host;
    #handler;
    #closed = false;
    #listeners = new Set();
    #httpConnections = new Set();
    #onError;
    constructor(serverInit){
        this.#port = serverInit.port;
        this.#host = serverInit.hostname;
        this.#handler = serverInit.handler;
        this.#onError = serverInit.onError ?? function(error) {
            console.error(error);
            return new Response("Internal Server Error", {
                status: 500
            });
        };
    }
    async serve(listener) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#trackListener(listener);
        try {
            return await this.#accept(listener);
        } finally{
            this.#untrackListener(listener);
            try {
                listener.close();
            } catch  {}
        }
    }
    async listenAndServe() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listen({
            port: this.#port ?? 80,
            hostname: this.#host ?? "0.0.0.0",
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    async listenAndServeTls(certFile, keyFile) {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        const listener = Deno.listenTls({
            port: this.#port ?? 443,
            hostname: this.#host ?? "0.0.0.0",
            certFile,
            keyFile,
            transport: "tcp"
        });
        return await this.serve(listener);
    }
    close() {
        if (this.#closed) {
            throw new Deno.errors.Http(ERROR_SERVER_CLOSED);
        }
        this.#closed = true;
        for (const listener of this.#listeners){
            try {
                listener.close();
            } catch  {}
        }
        this.#listeners.clear();
        for (const httpConn of this.#httpConnections){
            this.#closeHttpConn(httpConn);
        }
        this.#httpConnections.clear();
    }
    get closed() {
        return this.#closed;
    }
    get addrs() {
        return Array.from(this.#listeners).map((listener)=>listener.addr
        );
    }
    async #respond(requestEvent, httpConn, connInfo) {
        let response;
        try {
            response = await this.#handler(requestEvent.request, connInfo);
        } catch (error) {
            response = await this.#onError(error);
        }
        try {
            await requestEvent.respondWith(response);
        } catch  {
            return this.#closeHttpConn(httpConn);
        }
    }
    async #serveHttp(httpConn1, connInfo1) {
        while(!this.#closed){
            let requestEvent;
            try {
                requestEvent = await httpConn1.nextRequest();
            } catch  {
                break;
            }
            if (requestEvent === null) {
                break;
            }
            this.#respond(requestEvent, httpConn1, connInfo1);
        }
        this.#closeHttpConn(httpConn1);
    }
    async #accept(listener) {
        let acceptBackoffDelay;
        while(!this.#closed){
            let conn;
            try {
                conn = await listener.accept();
            } catch (error) {
                if (error instanceof Deno.errors.BadResource || error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof || error instanceof Deno.errors.ConnectionReset || error instanceof Deno.errors.NotConnected) {
                    if (!acceptBackoffDelay) {
                        acceptBackoffDelay = INITIAL_ACCEPT_BACKOFF_DELAY;
                    } else {
                        acceptBackoffDelay *= 2;
                    }
                    if (acceptBackoffDelay >= 1000) {
                        acceptBackoffDelay = MAX_ACCEPT_BACKOFF_DELAY;
                    }
                    await delay(acceptBackoffDelay);
                    continue;
                }
                throw error;
            }
            acceptBackoffDelay = undefined;
            let httpConn;
            try {
                httpConn = Deno.serveHttp(conn);
            } catch  {
                continue;
            }
            this.#trackHttpConnection(httpConn);
            const connInfo = {
                localAddr: conn.localAddr,
                remoteAddr: conn.remoteAddr
            };
            this.#serveHttp(httpConn, connInfo);
        }
    }
     #closeHttpConn(httpConn2) {
        this.#untrackHttpConnection(httpConn2);
        try {
            httpConn2.close();
        } catch  {}
    }
     #trackListener(listener1) {
        this.#listeners.add(listener1);
    }
     #untrackListener(listener2) {
        this.#listeners.delete(listener2);
    }
     #trackHttpConnection(httpConn3) {
        this.#httpConnections.add(httpConn3);
    }
     #untrackHttpConnection(httpConn4) {
        this.#httpConnections.delete(httpConn4);
    }
}
async function serve(handler, options = {}) {
    const server = new Server({
        port: options.port ?? 8000,
        hostname: options.hostname ?? "0.0.0.0",
        handler,
        onError: options.onError
    });
    if (options?.signal) {
        options.signal.onabort = ()=>server.close()
        ;
    }
    return await server.listenAndServe();
}
function removeEmptyValues(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value])=>{
        if (value === null) return false;
        if (value === undefined) return false;
        if (value === "") return false;
        return true;
    }));
}
function difference(arrA, arrB) {
    return arrA.filter((a)=>arrB.indexOf(a) < 0
    );
}
function parse(rawDotenv) {
    const env = {};
    for (const line of rawDotenv.split("\n")){
        if (!isVariableStart(line)) continue;
        const key = line.slice(0, line.indexOf("=")).trim();
        let value = line.slice(line.indexOf("=") + 1).trim();
        if (hasSingleQuotes(value)) {
            value = value.slice(1, -1);
        } else if (hasDoubleQuotes(value)) {
            value = value.slice(1, -1);
            value = expandNewlines(value);
        } else value = value.trim();
        env[key] = value;
    }
    return env;
}
const defaultConfigOptions = {
    path: `.env`,
    export: false,
    safe: false,
    example: `.env.example`,
    allowEmptyValues: false,
    defaults: `.env.defaults`
};
async function configAsync(options = {}) {
    const o = {
        ...defaultConfigOptions,
        ...options
    };
    const conf = await parseFileAsync(o.path);
    if (o.defaults) {
        const confDefaults = await parseFileAsync(o.defaults);
        for(const key in confDefaults){
            if (!(key in conf)) {
                conf[key] = confDefaults[key];
            }
        }
    }
    if (o.safe) {
        const confExample = await parseFileAsync(o.example);
        assertSafe(conf, confExample, o.allowEmptyValues);
    }
    if (o.export) {
        for(const key in conf){
            if (Deno.env.get(key) !== undefined) continue;
            Deno.env.set(key, conf[key]);
        }
    }
    return conf;
}
async function parseFileAsync(filepath) {
    try {
        return parse(new TextDecoder("utf-8").decode(await Deno.readFile(filepath)));
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) return {};
        throw e;
    }
}
function isVariableStart(str) {
    return /^\s*[a-zA-Z_][a-zA-Z_0-9 ]*\s*=/.test(str);
}
function hasSingleQuotes(str) {
    return /^'([\s\S]*)'$/.test(str);
}
function hasDoubleQuotes(str) {
    return /^"([\s\S]*)"$/.test(str);
}
function expandNewlines(str) {
    return str.replaceAll("\\n", "\n");
}
function assertSafe(conf, confExample, allowEmptyValues) {
    const currentEnv = Deno.env.toObject();
    const confWithEnv = Object.assign({}, currentEnv, conf);
    const missing = difference(Object.keys(confExample), Object.keys(allowEmptyValues ? confWithEnv : removeEmptyValues(confWithEnv)));
    if (missing.length > 0) {
        const errorMessages = [
            `The following variables were defined in the example file but are not present in the environment:\n  ${missing.join(", ")}`,
            `Make sure to add them to your env file.`,
            !allowEmptyValues && `If you expect any of these variables to be empty, you can set the allowEmptyValues option to true.`, 
        ];
        throw new MissingEnvVarsError(errorMessages.filter(Boolean).join("\n\n"));
    }
}
class MissingEnvVarsError extends Error {
    constructor(message){
        super(message);
        this.name = "MissingEnvVarsError";
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
await configAsync({
    export: true
});
Object.freeze({
    major: 15,
    minor: 0,
    patch: 0,
    preReleaseTag: null
});
function isPromise(value) {
    return typeof value?.then === 'function';
}
const nodejsCustomInspectSymbol = typeof Symbol === 'function' && typeof Symbol.for === 'function' ? Symbol.for('nodejs.util.inspect.custom') : undefined;
function inspect(value) {
    return formatValue(value, []);
}
function formatValue(value, seenValues) {
    switch(typeof value){
        case 'string':
            return JSON.stringify(value);
        case 'function':
            return value.name ? `[function ${value.name}]` : '[function]';
        case 'object':
            if (value === null) {
                return 'null';
            }
            return formatObjectValue(value, seenValues);
        default:
            return String(value);
    }
}
function formatObjectValue(value, previouslySeenValues) {
    if (previouslySeenValues.indexOf(value) !== -1) {
        return '[Circular]';
    }
    const seenValues = [
        ...previouslySeenValues,
        value
    ];
    const customInspectFn = getCustomFn(value);
    if (customInspectFn !== undefined) {
        const customValue = customInspectFn.call(value);
        if (customValue !== value) {
            return typeof customValue === 'string' ? customValue : formatValue(customValue, seenValues);
        }
    } else if (Array.isArray(value)) {
        return formatArray(value, seenValues);
    }
    return formatObject(value, seenValues);
}
function formatObject(object, seenValues) {
    const keys = Object.keys(object);
    if (keys.length === 0) {
        return '{}';
    }
    if (seenValues.length > 2) {
        return '[' + getObjectTag(object) + ']';
    }
    const properties = keys.map((key)=>{
        const value = formatValue(object[key], seenValues);
        return key + ': ' + value;
    });
    return '{ ' + properties.join(', ') + ' }';
}
function formatArray(array, seenValues) {
    if (array.length === 0) {
        return '[]';
    }
    if (seenValues.length > 2) {
        return '[Array]';
    }
    const len = Math.min(10, array.length);
    const remaining = array.length - len;
    const items = [];
    for(let i = 0; i < len; ++i){
        items.push(formatValue(array[i], seenValues));
    }
    if (remaining === 1) {
        items.push('... 1 more item');
    } else if (remaining > 1) {
        items.push(`... ${remaining} more items`);
    }
    return '[' + items.join(', ') + ']';
}
function getCustomFn(object) {
    const customInspectFn = object[String(nodejsCustomInspectSymbol)];
    if (typeof customInspectFn === 'function') {
        return customInspectFn;
    }
    if (typeof object.inspect === 'function') {
        return object.inspect;
    }
}
function getObjectTag(object) {
    const tag = Object.prototype.toString.call(object).replace(/^\[object /, '').replace(/]$/, '');
    if (tag === 'Object' && typeof object.constructor === 'function') {
        const name = object.constructor.name;
        if (typeof name === 'string' && name !== '') {
            return name;
        }
    }
    return tag;
}
function devAssert(condition, message) {
    const booleanCondition = Boolean(condition);
    if (!booleanCondition) {
        throw new Error(message);
    }
}
function isObjectLike(value) {
    return typeof value == 'object' && value !== null;
}
const SYMBOL_ITERATOR = typeof Symbol === 'function' ? Symbol.iterator : '@@iterator';
typeof Symbol === 'function' ? Symbol.asyncIterator : '@@asyncIterator';
const SYMBOL_TO_STRING_TAG = typeof Symbol === 'function' ? Symbol.toStringTag : '@@toStringTag';
function getLocation(source, position) {
    const lineRegexp = /\r\n|[\n\r]/g;
    let line = 1;
    let column = position + 1;
    let match;
    while((match = lineRegexp.exec(source.body)) && match.index < position){
        line += 1;
        column = position + 1 - (match.index + match[0].length);
    }
    return {
        line,
        column
    };
}
function printLocation(location) {
    return printSourceLocation(location.source, getLocation(location.source, location.start));
}
function printSourceLocation(source, sourceLocation) {
    const firstLineColumnOffset = source.locationOffset.column - 1;
    const body = whitespace(firstLineColumnOffset) + source.body;
    const lineIndex = sourceLocation.line - 1;
    const lineOffset = source.locationOffset.line - 1;
    const lineNum = sourceLocation.line + lineOffset;
    const columnOffset = sourceLocation.line === 1 ? firstLineColumnOffset : 0;
    const columnNum = sourceLocation.column + columnOffset;
    const locationStr = `${source.name}:${lineNum}:${columnNum}\n`;
    const lines = body.split(/\r\n|[\n\r]/g);
    const locationLine = lines[lineIndex];
    if (locationLine.length > 120) {
        const subLineIndex = Math.floor(columnNum / 80);
        const subLineColumnNum = columnNum % 80;
        const subLines = [];
        for(let i = 0; i < locationLine.length; i += 80){
            subLines.push(locationLine.slice(i, i + 80));
        }
        return locationStr + printPrefixedLines([
            [
                `${lineNum}`,
                subLines[0]
            ],
            ...subLines.slice(1, subLineIndex + 1).map((subLine)=>[
                    '',
                    subLine
                ]
            ),
            [
                ' ',
                whitespace(subLineColumnNum - 1) + '^'
            ],
            [
                '',
                subLines[subLineIndex + 1]
            ]
        ]);
    }
    return locationStr + printPrefixedLines([
        [
            `${lineNum - 1}`,
            lines[lineIndex - 1]
        ],
        [
            `${lineNum}`,
            locationLine
        ],
        [
            '',
            whitespace(columnNum - 1) + '^'
        ],
        [
            `${lineNum + 1}`,
            lines[lineIndex + 1]
        ]
    ]);
}
function printPrefixedLines(lines) {
    const existingLines = lines.filter(([_, line])=>line !== undefined
    );
    const padLen = Math.max(...existingLines.map(([prefix])=>prefix.length
    ));
    return existingLines.map(([prefix, line])=>leftPad(padLen, prefix) + (line ? ' | ' + line : ' |')
    ).join('\n');
}
function whitespace(len) {
    return Array(len + 1).join(' ');
}
function leftPad(len, str) {
    return whitespace(len - str.length) + str;
}
class GraphQLError extends Error {
    constructor(message, nodes, source, positions, path, originalError, extensions){
        super(message);
        const _nodes = Array.isArray(nodes) ? nodes.length !== 0 ? nodes : undefined : nodes ? [
            nodes
        ] : undefined;
        let _source = source;
        if (!_source && _nodes) {
            _source = _nodes[0].loc?.source;
        }
        let _positions = positions;
        if (!_positions && _nodes) {
            _positions = _nodes.reduce((list, node)=>{
                if (node.loc) {
                    list.push(node.loc.start);
                }
                return list;
            }, []);
        }
        if (_positions && _positions.length === 0) {
            _positions = undefined;
        }
        let _locations;
        if (positions && source) {
            _locations = positions.map((pos)=>getLocation(source, pos)
            );
        } else if (_nodes) {
            _locations = _nodes.reduce((list, node)=>{
                if (node.loc) {
                    list.push(getLocation(node.loc.source, node.loc.start));
                }
                return list;
            }, []);
        }
        let _extensions = extensions;
        if (_extensions == null && originalError != null) {
            const originalExtensions = originalError.extensions;
            if (isObjectLike(originalExtensions)) {
                _extensions = originalExtensions;
            }
        }
        Object.defineProperties(this, {
            name: {
                value: 'GraphQLError'
            },
            message: {
                value: message,
                enumerable: true,
                writable: true
            },
            locations: {
                value: _locations ?? undefined,
                enumerable: _locations != null
            },
            path: {
                value: path ?? undefined,
                enumerable: path != null
            },
            nodes: {
                value: _nodes ?? undefined
            },
            source: {
                value: _source ?? undefined
            },
            positions: {
                value: _positions ?? undefined
            },
            originalError: {
                value: originalError
            },
            extensions: {
                value: _extensions ?? undefined,
                enumerable: _extensions != null
            }
        });
        if (originalError?.stack) {
            Object.defineProperty(this, 'stack', {
                value: originalError.stack,
                writable: true,
                configurable: true
            });
            return;
        }
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, GraphQLError);
        } else {
            Object.defineProperty(this, 'stack', {
                value: Error().stack,
                writable: true,
                configurable: true
            });
        }
    }
    toString() {
        return printError(this);
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'Object';
    }
}
function printError(error) {
    let output = error.message;
    if (error.nodes) {
        for (const node of error.nodes){
            if (node.loc) {
                output += '\n\n' + printLocation(node.loc);
            }
        }
    } else if (error.source && error.locations) {
        for (const location of error.locations){
            output += '\n\n' + printSourceLocation(error.source, location);
        }
    }
    return output;
}
function syntaxError(source, position, description) {
    return new GraphQLError(`Syntax Error: ${description}`, undefined, source, [
        position
    ]);
}
const Kind = Object.freeze({
    NAME: 'Name',
    DOCUMENT: 'Document',
    OPERATION_DEFINITION: 'OperationDefinition',
    VARIABLE_DEFINITION: 'VariableDefinition',
    SELECTION_SET: 'SelectionSet',
    FIELD: 'Field',
    ARGUMENT: 'Argument',
    FRAGMENT_SPREAD: 'FragmentSpread',
    INLINE_FRAGMENT: 'InlineFragment',
    FRAGMENT_DEFINITION: 'FragmentDefinition',
    VARIABLE: 'Variable',
    INT: 'IntValue',
    FLOAT: 'FloatValue',
    STRING: 'StringValue',
    BOOLEAN: 'BooleanValue',
    NULL: 'NullValue',
    ENUM: 'EnumValue',
    LIST: 'ListValue',
    OBJECT: 'ObjectValue',
    OBJECT_FIELD: 'ObjectField',
    DIRECTIVE: 'Directive',
    NAMED_TYPE: 'NamedType',
    LIST_TYPE: 'ListType',
    NON_NULL_TYPE: 'NonNullType',
    SCHEMA_DEFINITION: 'SchemaDefinition',
    OPERATION_TYPE_DEFINITION: 'OperationTypeDefinition',
    SCALAR_TYPE_DEFINITION: 'ScalarTypeDefinition',
    OBJECT_TYPE_DEFINITION: 'ObjectTypeDefinition',
    FIELD_DEFINITION: 'FieldDefinition',
    INPUT_VALUE_DEFINITION: 'InputValueDefinition',
    INTERFACE_TYPE_DEFINITION: 'InterfaceTypeDefinition',
    UNION_TYPE_DEFINITION: 'UnionTypeDefinition',
    ENUM_TYPE_DEFINITION: 'EnumTypeDefinition',
    ENUM_VALUE_DEFINITION: 'EnumValueDefinition',
    INPUT_OBJECT_TYPE_DEFINITION: 'InputObjectTypeDefinition',
    DIRECTIVE_DEFINITION: 'DirectiveDefinition',
    SCHEMA_EXTENSION: 'SchemaExtension',
    SCALAR_TYPE_EXTENSION: 'ScalarTypeExtension',
    OBJECT_TYPE_EXTENSION: 'ObjectTypeExtension',
    INTERFACE_TYPE_EXTENSION: 'InterfaceTypeExtension',
    UNION_TYPE_EXTENSION: 'UnionTypeExtension',
    ENUM_TYPE_EXTENSION: 'EnumTypeExtension',
    INPUT_OBJECT_TYPE_EXTENSION: 'InputObjectTypeExtension'
});
class Source {
    constructor(body, name = 'GraphQL request', locationOffset = {
        line: 1,
        column: 1
    }){
        this.body = body;
        this.name = name;
        this.locationOffset = locationOffset;
        devAssert(this.locationOffset.line > 0, 'line in locationOffset is 1-indexed and must be positive.');
        devAssert(this.locationOffset.column > 0, 'column in locationOffset is 1-indexed and must be positive.');
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'Source';
    }
}
const DirectiveLocation = Object.freeze({
    QUERY: 'QUERY',
    MUTATION: 'MUTATION',
    SUBSCRIPTION: 'SUBSCRIPTION',
    FIELD: 'FIELD',
    FRAGMENT_DEFINITION: 'FRAGMENT_DEFINITION',
    FRAGMENT_SPREAD: 'FRAGMENT_SPREAD',
    INLINE_FRAGMENT: 'INLINE_FRAGMENT',
    VARIABLE_DEFINITION: 'VARIABLE_DEFINITION',
    SCHEMA: 'SCHEMA',
    SCALAR: 'SCALAR',
    OBJECT: 'OBJECT',
    FIELD_DEFINITION: 'FIELD_DEFINITION',
    ARGUMENT_DEFINITION: 'ARGUMENT_DEFINITION',
    INTERFACE: 'INTERFACE',
    UNION: 'UNION',
    ENUM: 'ENUM',
    ENUM_VALUE: 'ENUM_VALUE',
    INPUT_OBJECT: 'INPUT_OBJECT',
    INPUT_FIELD_DEFINITION: 'INPUT_FIELD_DEFINITION'
});
const TokenKind = Object.freeze({
    SOF: '<SOF>',
    EOF: '<EOF>',
    BANG: '!',
    DOLLAR: '$',
    AMP: '&',
    PAREN_L: '(',
    PAREN_R: ')',
    SPREAD: '...',
    COLON: ':',
    EQUALS: '=',
    AT: '@',
    BRACKET_L: '[',
    BRACKET_R: ']',
    BRACE_L: '{',
    PIPE: '|',
    BRACE_R: '}',
    NAME: 'Name',
    INT: 'Int',
    FLOAT: 'Float',
    STRING: 'String',
    BLOCK_STRING: 'BlockString',
    COMMENT: 'Comment'
});
function defineToJSON(classObject, fn = classObject.prototype.toString) {
    classObject.prototype.toJSON = fn;
    classObject.prototype.inspect = fn;
    if (nodejsCustomInspectSymbol) {
        classObject.prototype[nodejsCustomInspectSymbol] = fn;
    }
}
class Location {
    constructor(startToken, endToken, source){
        this.start = startToken.start;
        this.end = endToken.end;
        this.startToken = startToken;
        this.endToken = endToken;
        this.source = source;
    }
}
defineToJSON(Location, function() {
    return {
        start: this.start,
        end: this.end
    };
});
class Token {
    constructor(kind, start, end, line, column, prev, value){
        this.kind = kind;
        this.start = start;
        this.end = end;
        this.line = line;
        this.column = column;
        this.value = value;
        this.prev = prev;
        this.next = null;
    }
}
defineToJSON(Token, function() {
    return {
        kind: this.kind,
        value: this.value,
        line: this.line,
        column: this.column
    };
});
function isNode(maybeNode) {
    return maybeNode != null && typeof maybeNode.kind === 'string';
}
function dedentBlockStringValue(rawString) {
    const lines = rawString.split(/\r\n|[\n\r]/g);
    const commonIndent = getBlockStringIndentation(lines);
    if (commonIndent !== 0) {
        for(let i = 1; i < lines.length; i++){
            lines[i] = lines[i].slice(commonIndent);
        }
    }
    while(lines.length > 0 && isBlank(lines[0])){
        lines.shift();
    }
    while(lines.length > 0 && isBlank(lines[lines.length - 1])){
        lines.pop();
    }
    return lines.join('\n');
}
function getBlockStringIndentation(lines) {
    let commonIndent = null;
    for(let i = 1; i < lines.length; i++){
        const line = lines[i];
        const indent1 = leadingWhitespace(line);
        if (indent1 === line.length) {
            continue;
        }
        if (commonIndent === null || indent1 < commonIndent) {
            commonIndent = indent1;
            if (commonIndent === 0) {
                break;
            }
        }
    }
    return commonIndent === null ? 0 : commonIndent;
}
function leadingWhitespace(str) {
    let i = 0;
    while(i < str.length && (str[i] === ' ' || str[i] === '\t')){
        i++;
    }
    return i;
}
function isBlank(str) {
    return leadingWhitespace(str) === str.length;
}
function printBlockString(value, indentation = '', preferMultipleLines = false) {
    const isSingleLine = value.indexOf('\n') === -1;
    const hasLeadingSpace = value[0] === ' ' || value[0] === '\t';
    const hasTrailingQuote = value[value.length - 1] === '"';
    const printAsMultipleLines = !isSingleLine || hasTrailingQuote || preferMultipleLines;
    let result = '';
    if (printAsMultipleLines && !(isSingleLine && hasLeadingSpace)) {
        result += '\n' + indentation;
    }
    result += indentation ? value.replace(/\n/g, '\n' + indentation) : value;
    if (printAsMultipleLines) {
        result += '\n';
    }
    return '"""' + result.replace(/"""/g, '\\"""') + '"""';
}
class Lexer {
    constructor(source){
        const startOfFileToken = new Token(TokenKind.SOF, 0, 0, 0, 0, null);
        this.source = source;
        this.lastToken = startOfFileToken;
        this.token = startOfFileToken;
        this.line = 1;
        this.lineStart = 0;
    }
    advance() {
        this.lastToken = this.token;
        const token = this.token = this.lookahead();
        return token;
    }
    lookahead() {
        let token = this.token;
        if (token.kind !== TokenKind.EOF) {
            do {
                token = token.next ?? (token.next = readToken(this, token));
            }while (token.kind === TokenKind.COMMENT)
        }
        return token;
    }
}
function isPunctuatorTokenKind(kind) {
    return kind === TokenKind.BANG || kind === TokenKind.DOLLAR || kind === TokenKind.AMP || kind === TokenKind.PAREN_L || kind === TokenKind.PAREN_R || kind === TokenKind.SPREAD || kind === TokenKind.COLON || kind === TokenKind.EQUALS || kind === TokenKind.AT || kind === TokenKind.BRACKET_L || kind === TokenKind.BRACKET_R || kind === TokenKind.BRACE_L || kind === TokenKind.PIPE || kind === TokenKind.BRACE_R;
}
function printCharCode(code) {
    return isNaN(code) ? TokenKind.EOF : code < 127 ? JSON.stringify(String.fromCharCode(code)) : `"\\u${('00' + code.toString(16).toUpperCase()).slice(-4)}"`;
}
function readToken(lexer, prev) {
    const source = lexer.source;
    const body = source.body;
    const bodyLength = body.length;
    const pos = positionAfterWhitespace(body, prev.end, lexer);
    const line = lexer.line;
    const col = 1 + pos - lexer.lineStart;
    if (pos >= bodyLength) {
        return new Token(TokenKind.EOF, bodyLength, bodyLength, line, col, prev);
    }
    const code = body.charCodeAt(pos);
    switch(code){
        case 33:
            return new Token(TokenKind.BANG, pos, pos + 1, line, col, prev);
        case 35:
            return readComment(source, pos, line, col, prev);
        case 36:
            return new Token(TokenKind.DOLLAR, pos, pos + 1, line, col, prev);
        case 38:
            return new Token(TokenKind.AMP, pos, pos + 1, line, col, prev);
        case 40:
            return new Token(TokenKind.PAREN_L, pos, pos + 1, line, col, prev);
        case 41:
            return new Token(TokenKind.PAREN_R, pos, pos + 1, line, col, prev);
        case 46:
            if (body.charCodeAt(pos + 1) === 46 && body.charCodeAt(pos + 2) === 46) {
                return new Token(TokenKind.SPREAD, pos, pos + 3, line, col, prev);
            }
            break;
        case 58:
            return new Token(TokenKind.COLON, pos, pos + 1, line, col, prev);
        case 61:
            return new Token(TokenKind.EQUALS, pos, pos + 1, line, col, prev);
        case 64:
            return new Token(TokenKind.AT, pos, pos + 1, line, col, prev);
        case 91:
            return new Token(TokenKind.BRACKET_L, pos, pos + 1, line, col, prev);
        case 93:
            return new Token(TokenKind.BRACKET_R, pos, pos + 1, line, col, prev);
        case 123:
            return new Token(TokenKind.BRACE_L, pos, pos + 1, line, col, prev);
        case 124:
            return new Token(TokenKind.PIPE, pos, pos + 1, line, col, prev);
        case 125:
            return new Token(TokenKind.BRACE_R, pos, pos + 1, line, col, prev);
        case 65:
        case 66:
        case 67:
        case 68:
        case 69:
        case 70:
        case 71:
        case 72:
        case 73:
        case 74:
        case 75:
        case 76:
        case 77:
        case 78:
        case 79:
        case 80:
        case 81:
        case 82:
        case 83:
        case 84:
        case 85:
        case 86:
        case 87:
        case 88:
        case 89:
        case 90:
        case 95:
        case 97:
        case 98:
        case 99:
        case 100:
        case 101:
        case 102:
        case 103:
        case 104:
        case 105:
        case 106:
        case 107:
        case 108:
        case 109:
        case 110:
        case 111:
        case 112:
        case 113:
        case 114:
        case 115:
        case 116:
        case 117:
        case 118:
        case 119:
        case 120:
        case 121:
        case 122:
            return readName(source, pos, line, col, prev);
        case 45:
        case 48:
        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
            return readNumber(source, pos, code, line, col, prev);
        case 34:
            if (body.charCodeAt(pos + 1) === 34 && body.charCodeAt(pos + 2) === 34) {
                return readBlockString(source, pos, line, col, prev, lexer);
            }
            return readString(source, pos, line, col, prev);
    }
    throw syntaxError(source, pos, unexpectedCharacterMessage(code));
}
function unexpectedCharacterMessage(code) {
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
        return `Cannot contain the invalid character ${printCharCode(code)}.`;
    }
    if (code === 39) {
        return 'Unexpected single quote character (\'), did you mean to use a double quote (")?';
    }
    return `Cannot parse the unexpected character ${printCharCode(code)}.`;
}
function positionAfterWhitespace(body, startPosition, lexer) {
    const bodyLength = body.length;
    let position = startPosition;
    while(position < bodyLength){
        const code = body.charCodeAt(position);
        if (code === 9 || code === 32 || code === 44 || code === 65279) {
            ++position;
        } else if (code === 10) {
            ++position;
            ++lexer.line;
            lexer.lineStart = position;
        } else if (code === 13) {
            if (body.charCodeAt(position + 1) === 10) {
                position += 2;
            } else {
                ++position;
            }
            ++lexer.line;
            lexer.lineStart = position;
        } else {
            break;
        }
    }
    return position;
}
function readComment(source, start, line, col, prev) {
    const body = source.body;
    let code;
    let position = start;
    do {
        code = body.charCodeAt(++position);
    }while (!isNaN(code) && (code > 31 || code === 9))
    return new Token(TokenKind.COMMENT, start, position, line, col, prev, body.slice(start + 1, position));
}
function readNumber(source, start, firstCode, line, col, prev) {
    const body = source.body;
    let code = firstCode;
    let position = start;
    let isFloat = false;
    if (code === 45) {
        code = body.charCodeAt(++position);
    }
    if (code === 48) {
        code = body.charCodeAt(++position);
        if (code >= 48 && code <= 57) {
            throw syntaxError(source, position, `Invalid number, unexpected digit after 0: ${printCharCode(code)}.`);
        }
    } else {
        position = readDigits(source, position, code);
        code = body.charCodeAt(position);
    }
    if (code === 46) {
        isFloat = true;
        code = body.charCodeAt(++position);
        position = readDigits(source, position, code);
        code = body.charCodeAt(position);
    }
    if (code === 69 || code === 101) {
        isFloat = true;
        code = body.charCodeAt(++position);
        if (code === 43 || code === 45) {
            code = body.charCodeAt(++position);
        }
        position = readDigits(source, position, code);
        code = body.charCodeAt(position);
    }
    if (code === 46 || isNameStart(code)) {
        throw syntaxError(source, position, `Invalid number, expected digit but got: ${printCharCode(code)}.`);
    }
    return new Token(isFloat ? TokenKind.FLOAT : TokenKind.INT, start, position, line, col, prev, body.slice(start, position));
}
function readDigits(source, start, firstCode) {
    const body = source.body;
    let position = start;
    let code = firstCode;
    if (code >= 48 && code <= 57) {
        do {
            code = body.charCodeAt(++position);
        }while (code >= 48 && code <= 57)
        return position;
    }
    throw syntaxError(source, position, `Invalid number, expected digit but got: ${printCharCode(code)}.`);
}
function readString(source, start, line, col, prev) {
    const body = source.body;
    let position = start + 1;
    let chunkStart = position;
    let code = 0;
    let value = '';
    while(position < body.length && !isNaN(code = body.charCodeAt(position)) && code !== 10 && code !== 13){
        if (code === 34) {
            value += body.slice(chunkStart, position);
            return new Token(TokenKind.STRING, start, position + 1, line, col, prev, value);
        }
        if (code < 32 && code !== 9) {
            throw syntaxError(source, position, `Invalid character within String: ${printCharCode(code)}.`);
        }
        ++position;
        if (code === 92) {
            value += body.slice(chunkStart, position - 1);
            code = body.charCodeAt(position);
            switch(code){
                case 34:
                    value += '"';
                    break;
                case 47:
                    value += '/';
                    break;
                case 92:
                    value += '\\';
                    break;
                case 98:
                    value += '\b';
                    break;
                case 102:
                    value += '\f';
                    break;
                case 110:
                    value += '\n';
                    break;
                case 114:
                    value += '\r';
                    break;
                case 116:
                    value += '\t';
                    break;
                case 117:
                    {
                        const charCode = uniCharCode(body.charCodeAt(position + 1), body.charCodeAt(position + 2), body.charCodeAt(position + 3), body.charCodeAt(position + 4));
                        if (charCode < 0) {
                            const invalidSequence = body.slice(position + 1, position + 5);
                            throw syntaxError(source, position, `Invalid character escape sequence: \\u${invalidSequence}.`);
                        }
                        value += String.fromCharCode(charCode);
                        position += 4;
                        break;
                    }
                default:
                    throw syntaxError(source, position, `Invalid character escape sequence: \\${String.fromCharCode(code)}.`);
            }
            ++position;
            chunkStart = position;
        }
    }
    throw syntaxError(source, position, 'Unterminated string.');
}
function readBlockString(source, start, line, col, prev, lexer) {
    const body = source.body;
    let position = start + 3;
    let chunkStart = position;
    let code = 0;
    let rawValue = '';
    while(position < body.length && !isNaN(code = body.charCodeAt(position))){
        if (code === 34 && body.charCodeAt(position + 1) === 34 && body.charCodeAt(position + 2) === 34) {
            rawValue += body.slice(chunkStart, position);
            return new Token(TokenKind.BLOCK_STRING, start, position + 3, line, col, prev, dedentBlockStringValue(rawValue));
        }
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
            throw syntaxError(source, position, `Invalid character within String: ${printCharCode(code)}.`);
        }
        if (code === 10) {
            ++position;
            ++lexer.line;
            lexer.lineStart = position;
        } else if (code === 13) {
            if (body.charCodeAt(position + 1) === 10) {
                position += 2;
            } else {
                ++position;
            }
            ++lexer.line;
            lexer.lineStart = position;
        } else if (code === 92 && body.charCodeAt(position + 1) === 34 && body.charCodeAt(position + 2) === 34 && body.charCodeAt(position + 3) === 34) {
            rawValue += body.slice(chunkStart, position) + '"""';
            position += 4;
            chunkStart = position;
        } else {
            ++position;
        }
    }
    throw syntaxError(source, position, 'Unterminated string.');
}
function uniCharCode(a, b, c, d) {
    return char2hex(a) << 12 | char2hex(b) << 8 | char2hex(c) << 4 | char2hex(d);
}
function char2hex(a) {
    return a >= 48 && a <= 57 ? a - 48 : a >= 65 && a <= 70 ? a - 55 : a >= 97 && a <= 102 ? a - 87 : -1;
}
function readName(source, start, line, col, prev) {
    const body = source.body;
    const bodyLength = body.length;
    let position = start + 1;
    let code = 0;
    while(position !== bodyLength && !isNaN(code = body.charCodeAt(position)) && (code === 95 || code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122)){
        ++position;
    }
    return new Token(TokenKind.NAME, start, position, line, col, prev, body.slice(start, position));
}
function isNameStart(code) {
    return code === 95 || code >= 65 && code <= 90 || code >= 97 && code <= 122;
}
function parse1(source, options) {
    const parser = new Parser(source, options);
    return parser.parseDocument();
}
class Parser {
    constructor(source, options){
        const sourceObj = typeof source === 'string' ? new Source(source) : source;
        devAssert(sourceObj instanceof Source, `Must provide Source. Received: ${inspect(sourceObj)}.`);
        this._lexer = new Lexer(sourceObj);
        this._options = options;
    }
    parseName() {
        const token = this.expectToken(TokenKind.NAME);
        return {
            kind: Kind.NAME,
            value: token.value,
            loc: this.loc(token)
        };
    }
    parseDocument() {
        const start = this._lexer.token;
        return {
            kind: Kind.DOCUMENT,
            definitions: this.many(TokenKind.SOF, this.parseDefinition, TokenKind.EOF),
            loc: this.loc(start)
        };
    }
    parseDefinition() {
        if (this.peek(TokenKind.NAME)) {
            switch(this._lexer.token.value){
                case 'query':
                case 'mutation':
                case 'subscription':
                    return this.parseOperationDefinition();
                case 'fragment':
                    return this.parseFragmentDefinition();
                case 'schema':
                case 'scalar':
                case 'type':
                case 'interface':
                case 'union':
                case 'enum':
                case 'input':
                case 'directive':
                    return this.parseTypeSystemDefinition();
                case 'extend':
                    return this.parseTypeSystemExtension();
            }
        } else if (this.peek(TokenKind.BRACE_L)) {
            return this.parseOperationDefinition();
        } else if (this.peekDescription()) {
            return this.parseTypeSystemDefinition();
        }
        throw this.unexpected();
    }
    parseOperationDefinition() {
        const start = this._lexer.token;
        if (this.peek(TokenKind.BRACE_L)) {
            return {
                kind: Kind.OPERATION_DEFINITION,
                operation: 'query',
                name: undefined,
                variableDefinitions: [],
                directives: [],
                selectionSet: this.parseSelectionSet(),
                loc: this.loc(start)
            };
        }
        const operation = this.parseOperationType();
        let name;
        if (this.peek(TokenKind.NAME)) {
            name = this.parseName();
        }
        return {
            kind: Kind.OPERATION_DEFINITION,
            operation,
            name,
            variableDefinitions: this.parseVariableDefinitions(),
            directives: this.parseDirectives(false),
            selectionSet: this.parseSelectionSet(),
            loc: this.loc(start)
        };
    }
    parseOperationType() {
        const operationToken = this.expectToken(TokenKind.NAME);
        switch(operationToken.value){
            case 'query':
                return 'query';
            case 'mutation':
                return 'mutation';
            case 'subscription':
                return 'subscription';
        }
        throw this.unexpected(operationToken);
    }
    parseVariableDefinitions() {
        return this.optionalMany(TokenKind.PAREN_L, this.parseVariableDefinition, TokenKind.PAREN_R);
    }
    parseVariableDefinition() {
        const start = this._lexer.token;
        return {
            kind: Kind.VARIABLE_DEFINITION,
            variable: this.parseVariable(),
            type: (this.expectToken(TokenKind.COLON), this.parseTypeReference()),
            defaultValue: this.expectOptionalToken(TokenKind.EQUALS) ? this.parseValueLiteral(true) : undefined,
            directives: this.parseDirectives(true),
            loc: this.loc(start)
        };
    }
    parseVariable() {
        const start = this._lexer.token;
        this.expectToken(TokenKind.DOLLAR);
        return {
            kind: Kind.VARIABLE,
            name: this.parseName(),
            loc: this.loc(start)
        };
    }
    parseSelectionSet() {
        const start = this._lexer.token;
        return {
            kind: Kind.SELECTION_SET,
            selections: this.many(TokenKind.BRACE_L, this.parseSelection, TokenKind.BRACE_R),
            loc: this.loc(start)
        };
    }
    parseSelection() {
        return this.peek(TokenKind.SPREAD) ? this.parseFragment() : this.parseField();
    }
    parseField() {
        const start = this._lexer.token;
        const nameOrAlias = this.parseName();
        let alias;
        let name;
        if (this.expectOptionalToken(TokenKind.COLON)) {
            alias = nameOrAlias;
            name = this.parseName();
        } else {
            name = nameOrAlias;
        }
        return {
            kind: Kind.FIELD,
            alias,
            name,
            arguments: this.parseArguments(false),
            directives: this.parseDirectives(false),
            selectionSet: this.peek(TokenKind.BRACE_L) ? this.parseSelectionSet() : undefined,
            loc: this.loc(start)
        };
    }
    parseArguments(isConst) {
        const item = isConst ? this.parseConstArgument : this.parseArgument;
        return this.optionalMany(TokenKind.PAREN_L, item, TokenKind.PAREN_R);
    }
    parseArgument() {
        const start = this._lexer.token;
        const name = this.parseName();
        this.expectToken(TokenKind.COLON);
        return {
            kind: Kind.ARGUMENT,
            name,
            value: this.parseValueLiteral(false),
            loc: this.loc(start)
        };
    }
    parseConstArgument() {
        const start = this._lexer.token;
        return {
            kind: Kind.ARGUMENT,
            name: this.parseName(),
            value: (this.expectToken(TokenKind.COLON), this.parseValueLiteral(true)),
            loc: this.loc(start)
        };
    }
    parseFragment() {
        const start = this._lexer.token;
        this.expectToken(TokenKind.SPREAD);
        const hasTypeCondition = this.expectOptionalKeyword('on');
        if (!hasTypeCondition && this.peek(TokenKind.NAME)) {
            return {
                kind: Kind.FRAGMENT_SPREAD,
                name: this.parseFragmentName(),
                directives: this.parseDirectives(false),
                loc: this.loc(start)
            };
        }
        return {
            kind: Kind.INLINE_FRAGMENT,
            typeCondition: hasTypeCondition ? this.parseNamedType() : undefined,
            directives: this.parseDirectives(false),
            selectionSet: this.parseSelectionSet(),
            loc: this.loc(start)
        };
    }
    parseFragmentDefinition() {
        const start = this._lexer.token;
        this.expectKeyword('fragment');
        if (this._options?.experimentalFragmentVariables === true) {
            return {
                kind: Kind.FRAGMENT_DEFINITION,
                name: this.parseFragmentName(),
                variableDefinitions: this.parseVariableDefinitions(),
                typeCondition: (this.expectKeyword('on'), this.parseNamedType()),
                directives: this.parseDirectives(false),
                selectionSet: this.parseSelectionSet(),
                loc: this.loc(start)
            };
        }
        return {
            kind: Kind.FRAGMENT_DEFINITION,
            name: this.parseFragmentName(),
            typeCondition: (this.expectKeyword('on'), this.parseNamedType()),
            directives: this.parseDirectives(false),
            selectionSet: this.parseSelectionSet(),
            loc: this.loc(start)
        };
    }
    parseFragmentName() {
        if (this._lexer.token.value === 'on') {
            throw this.unexpected();
        }
        return this.parseName();
    }
    parseValueLiteral(isConst) {
        const token = this._lexer.token;
        switch(token.kind){
            case TokenKind.BRACKET_L:
                return this.parseList(isConst);
            case TokenKind.BRACE_L:
                return this.parseObject(isConst);
            case TokenKind.INT:
                this._lexer.advance();
                return {
                    kind: Kind.INT,
                    value: token.value,
                    loc: this.loc(token)
                };
            case TokenKind.FLOAT:
                this._lexer.advance();
                return {
                    kind: Kind.FLOAT,
                    value: token.value,
                    loc: this.loc(token)
                };
            case TokenKind.STRING:
            case TokenKind.BLOCK_STRING:
                return this.parseStringLiteral();
            case TokenKind.NAME:
                this._lexer.advance();
                switch(token.value){
                    case 'true':
                        return {
                            kind: Kind.BOOLEAN,
                            value: true,
                            loc: this.loc(token)
                        };
                    case 'false':
                        return {
                            kind: Kind.BOOLEAN,
                            value: false,
                            loc: this.loc(token)
                        };
                    case 'null':
                        return {
                            kind: Kind.NULL,
                            loc: this.loc(token)
                        };
                    default:
                        return {
                            kind: Kind.ENUM,
                            value: token.value,
                            loc: this.loc(token)
                        };
                }
            case TokenKind.DOLLAR:
                if (!isConst) {
                    return this.parseVariable();
                }
                break;
        }
        throw this.unexpected();
    }
    parseStringLiteral() {
        const token = this._lexer.token;
        this._lexer.advance();
        return {
            kind: Kind.STRING,
            value: token.value,
            block: token.kind === TokenKind.BLOCK_STRING,
            loc: this.loc(token)
        };
    }
    parseList(isConst) {
        const start = this._lexer.token;
        const item = ()=>this.parseValueLiteral(isConst)
        ;
        return {
            kind: Kind.LIST,
            values: this.any(TokenKind.BRACKET_L, item, TokenKind.BRACKET_R),
            loc: this.loc(start)
        };
    }
    parseObject(isConst) {
        const start = this._lexer.token;
        const item = ()=>this.parseObjectField(isConst)
        ;
        return {
            kind: Kind.OBJECT,
            fields: this.any(TokenKind.BRACE_L, item, TokenKind.BRACE_R),
            loc: this.loc(start)
        };
    }
    parseObjectField(isConst) {
        const start = this._lexer.token;
        const name = this.parseName();
        this.expectToken(TokenKind.COLON);
        return {
            kind: Kind.OBJECT_FIELD,
            name,
            value: this.parseValueLiteral(isConst),
            loc: this.loc(start)
        };
    }
    parseDirectives(isConst) {
        const directives = [];
        while(this.peek(TokenKind.AT)){
            directives.push(this.parseDirective(isConst));
        }
        return directives;
    }
    parseDirective(isConst) {
        const start = this._lexer.token;
        this.expectToken(TokenKind.AT);
        return {
            kind: Kind.DIRECTIVE,
            name: this.parseName(),
            arguments: this.parseArguments(isConst),
            loc: this.loc(start)
        };
    }
    parseTypeReference() {
        const start = this._lexer.token;
        let type;
        if (this.expectOptionalToken(TokenKind.BRACKET_L)) {
            type = this.parseTypeReference();
            this.expectToken(TokenKind.BRACKET_R);
            type = {
                kind: Kind.LIST_TYPE,
                type,
                loc: this.loc(start)
            };
        } else {
            type = this.parseNamedType();
        }
        if (this.expectOptionalToken(TokenKind.BANG)) {
            return {
                kind: Kind.NON_NULL_TYPE,
                type,
                loc: this.loc(start)
            };
        }
        return type;
    }
    parseNamedType() {
        const start = this._lexer.token;
        return {
            kind: Kind.NAMED_TYPE,
            name: this.parseName(),
            loc: this.loc(start)
        };
    }
    parseTypeSystemDefinition() {
        const keywordToken = this.peekDescription() ? this._lexer.lookahead() : this._lexer.token;
        if (keywordToken.kind === TokenKind.NAME) {
            switch(keywordToken.value){
                case 'schema':
                    return this.parseSchemaDefinition();
                case 'scalar':
                    return this.parseScalarTypeDefinition();
                case 'type':
                    return this.parseObjectTypeDefinition();
                case 'interface':
                    return this.parseInterfaceTypeDefinition();
                case 'union':
                    return this.parseUnionTypeDefinition();
                case 'enum':
                    return this.parseEnumTypeDefinition();
                case 'input':
                    return this.parseInputObjectTypeDefinition();
                case 'directive':
                    return this.parseDirectiveDefinition();
            }
        }
        throw this.unexpected(keywordToken);
    }
    peekDescription() {
        return this.peek(TokenKind.STRING) || this.peek(TokenKind.BLOCK_STRING);
    }
    parseDescription() {
        if (this.peekDescription()) {
            return this.parseStringLiteral();
        }
    }
    parseSchemaDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('schema');
        const directives = this.parseDirectives(true);
        const operationTypes = this.many(TokenKind.BRACE_L, this.parseOperationTypeDefinition, TokenKind.BRACE_R);
        return {
            kind: Kind.SCHEMA_DEFINITION,
            description,
            directives,
            operationTypes,
            loc: this.loc(start)
        };
    }
    parseOperationTypeDefinition() {
        const start = this._lexer.token;
        const operation = this.parseOperationType();
        this.expectToken(TokenKind.COLON);
        const type = this.parseNamedType();
        return {
            kind: Kind.OPERATION_TYPE_DEFINITION,
            operation,
            type,
            loc: this.loc(start)
        };
    }
    parseScalarTypeDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('scalar');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        return {
            kind: Kind.SCALAR_TYPE_DEFINITION,
            description,
            name,
            directives,
            loc: this.loc(start)
        };
    }
    parseObjectTypeDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('type');
        const name = this.parseName();
        const interfaces = this.parseImplementsInterfaces();
        const directives = this.parseDirectives(true);
        const fields = this.parseFieldsDefinition();
        return {
            kind: Kind.OBJECT_TYPE_DEFINITION,
            description,
            name,
            interfaces,
            directives,
            fields,
            loc: this.loc(start)
        };
    }
    parseImplementsInterfaces() {
        const types = [];
        if (this.expectOptionalKeyword('implements')) {
            this.expectOptionalToken(TokenKind.AMP);
            do {
                types.push(this.parseNamedType());
            }while (this.expectOptionalToken(TokenKind.AMP) || this._options?.allowLegacySDLImplementsInterfaces === true && this.peek(TokenKind.NAME))
        }
        return types;
    }
    parseFieldsDefinition() {
        if (this._options?.allowLegacySDLEmptyFields === true && this.peek(TokenKind.BRACE_L) && this._lexer.lookahead().kind === TokenKind.BRACE_R) {
            this._lexer.advance();
            this._lexer.advance();
            return [];
        }
        return this.optionalMany(TokenKind.BRACE_L, this.parseFieldDefinition, TokenKind.BRACE_R);
    }
    parseFieldDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        const name = this.parseName();
        const args = this.parseArgumentDefs();
        this.expectToken(TokenKind.COLON);
        const type = this.parseTypeReference();
        const directives = this.parseDirectives(true);
        return {
            kind: Kind.FIELD_DEFINITION,
            description,
            name,
            arguments: args,
            type,
            directives,
            loc: this.loc(start)
        };
    }
    parseArgumentDefs() {
        return this.optionalMany(TokenKind.PAREN_L, this.parseInputValueDef, TokenKind.PAREN_R);
    }
    parseInputValueDef() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        const name = this.parseName();
        this.expectToken(TokenKind.COLON);
        const type = this.parseTypeReference();
        let defaultValue;
        if (this.expectOptionalToken(TokenKind.EQUALS)) {
            defaultValue = this.parseValueLiteral(true);
        }
        const directives = this.parseDirectives(true);
        return {
            kind: Kind.INPUT_VALUE_DEFINITION,
            description,
            name,
            type,
            defaultValue,
            directives,
            loc: this.loc(start)
        };
    }
    parseInterfaceTypeDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('interface');
        const name = this.parseName();
        const interfaces = this.parseImplementsInterfaces();
        const directives = this.parseDirectives(true);
        const fields = this.parseFieldsDefinition();
        return {
            kind: Kind.INTERFACE_TYPE_DEFINITION,
            description,
            name,
            interfaces,
            directives,
            fields,
            loc: this.loc(start)
        };
    }
    parseUnionTypeDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('union');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        const types = this.parseUnionMemberTypes();
        return {
            kind: Kind.UNION_TYPE_DEFINITION,
            description,
            name,
            directives,
            types,
            loc: this.loc(start)
        };
    }
    parseUnionMemberTypes() {
        const types = [];
        if (this.expectOptionalToken(TokenKind.EQUALS)) {
            this.expectOptionalToken(TokenKind.PIPE);
            do {
                types.push(this.parseNamedType());
            }while (this.expectOptionalToken(TokenKind.PIPE))
        }
        return types;
    }
    parseEnumTypeDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('enum');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        const values = this.parseEnumValuesDefinition();
        return {
            kind: Kind.ENUM_TYPE_DEFINITION,
            description,
            name,
            directives,
            values,
            loc: this.loc(start)
        };
    }
    parseEnumValuesDefinition() {
        return this.optionalMany(TokenKind.BRACE_L, this.parseEnumValueDefinition, TokenKind.BRACE_R);
    }
    parseEnumValueDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        return {
            kind: Kind.ENUM_VALUE_DEFINITION,
            description,
            name,
            directives,
            loc: this.loc(start)
        };
    }
    parseInputObjectTypeDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('input');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        const fields = this.parseInputFieldsDefinition();
        return {
            kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
            description,
            name,
            directives,
            fields,
            loc: this.loc(start)
        };
    }
    parseInputFieldsDefinition() {
        return this.optionalMany(TokenKind.BRACE_L, this.parseInputValueDef, TokenKind.BRACE_R);
    }
    parseTypeSystemExtension() {
        const keywordToken = this._lexer.lookahead();
        if (keywordToken.kind === TokenKind.NAME) {
            switch(keywordToken.value){
                case 'schema':
                    return this.parseSchemaExtension();
                case 'scalar':
                    return this.parseScalarTypeExtension();
                case 'type':
                    return this.parseObjectTypeExtension();
                case 'interface':
                    return this.parseInterfaceTypeExtension();
                case 'union':
                    return this.parseUnionTypeExtension();
                case 'enum':
                    return this.parseEnumTypeExtension();
                case 'input':
                    return this.parseInputObjectTypeExtension();
            }
        }
        throw this.unexpected(keywordToken);
    }
    parseSchemaExtension() {
        const start = this._lexer.token;
        this.expectKeyword('extend');
        this.expectKeyword('schema');
        const directives = this.parseDirectives(true);
        const operationTypes = this.optionalMany(TokenKind.BRACE_L, this.parseOperationTypeDefinition, TokenKind.BRACE_R);
        if (directives.length === 0 && operationTypes.length === 0) {
            throw this.unexpected();
        }
        return {
            kind: Kind.SCHEMA_EXTENSION,
            directives,
            operationTypes,
            loc: this.loc(start)
        };
    }
    parseScalarTypeExtension() {
        const start = this._lexer.token;
        this.expectKeyword('extend');
        this.expectKeyword('scalar');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        if (directives.length === 0) {
            throw this.unexpected();
        }
        return {
            kind: Kind.SCALAR_TYPE_EXTENSION,
            name,
            directives,
            loc: this.loc(start)
        };
    }
    parseObjectTypeExtension() {
        const start = this._lexer.token;
        this.expectKeyword('extend');
        this.expectKeyword('type');
        const name = this.parseName();
        const interfaces = this.parseImplementsInterfaces();
        const directives = this.parseDirectives(true);
        const fields = this.parseFieldsDefinition();
        if (interfaces.length === 0 && directives.length === 0 && fields.length === 0) {
            throw this.unexpected();
        }
        return {
            kind: Kind.OBJECT_TYPE_EXTENSION,
            name,
            interfaces,
            directives,
            fields,
            loc: this.loc(start)
        };
    }
    parseInterfaceTypeExtension() {
        const start = this._lexer.token;
        this.expectKeyword('extend');
        this.expectKeyword('interface');
        const name = this.parseName();
        const interfaces = this.parseImplementsInterfaces();
        const directives = this.parseDirectives(true);
        const fields = this.parseFieldsDefinition();
        if (interfaces.length === 0 && directives.length === 0 && fields.length === 0) {
            throw this.unexpected();
        }
        return {
            kind: Kind.INTERFACE_TYPE_EXTENSION,
            name,
            interfaces,
            directives,
            fields,
            loc: this.loc(start)
        };
    }
    parseUnionTypeExtension() {
        const start = this._lexer.token;
        this.expectKeyword('extend');
        this.expectKeyword('union');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        const types = this.parseUnionMemberTypes();
        if (directives.length === 0 && types.length === 0) {
            throw this.unexpected();
        }
        return {
            kind: Kind.UNION_TYPE_EXTENSION,
            name,
            directives,
            types,
            loc: this.loc(start)
        };
    }
    parseEnumTypeExtension() {
        const start = this._lexer.token;
        this.expectKeyword('extend');
        this.expectKeyword('enum');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        const values = this.parseEnumValuesDefinition();
        if (directives.length === 0 && values.length === 0) {
            throw this.unexpected();
        }
        return {
            kind: Kind.ENUM_TYPE_EXTENSION,
            name,
            directives,
            values,
            loc: this.loc(start)
        };
    }
    parseInputObjectTypeExtension() {
        const start = this._lexer.token;
        this.expectKeyword('extend');
        this.expectKeyword('input');
        const name = this.parseName();
        const directives = this.parseDirectives(true);
        const fields = this.parseInputFieldsDefinition();
        if (directives.length === 0 && fields.length === 0) {
            throw this.unexpected();
        }
        return {
            kind: Kind.INPUT_OBJECT_TYPE_EXTENSION,
            name,
            directives,
            fields,
            loc: this.loc(start)
        };
    }
    parseDirectiveDefinition() {
        const start = this._lexer.token;
        const description = this.parseDescription();
        this.expectKeyword('directive');
        this.expectToken(TokenKind.AT);
        const name = this.parseName();
        const args = this.parseArgumentDefs();
        const repeatable = this.expectOptionalKeyword('repeatable');
        this.expectKeyword('on');
        const locations = this.parseDirectiveLocations();
        return {
            kind: Kind.DIRECTIVE_DEFINITION,
            description,
            name,
            arguments: args,
            repeatable,
            locations,
            loc: this.loc(start)
        };
    }
    parseDirectiveLocations() {
        this.expectOptionalToken(TokenKind.PIPE);
        const locations = [];
        do {
            locations.push(this.parseDirectiveLocation());
        }while (this.expectOptionalToken(TokenKind.PIPE))
        return locations;
    }
    parseDirectiveLocation() {
        const start = this._lexer.token;
        const name = this.parseName();
        if (DirectiveLocation[name.value] !== undefined) {
            return name;
        }
        throw this.unexpected(start);
    }
    loc(startToken) {
        if (this._options?.noLocation !== true) {
            return new Location(startToken, this._lexer.lastToken, this._lexer.source);
        }
    }
    peek(kind) {
        return this._lexer.token.kind === kind;
    }
    expectToken(kind) {
        const token = this._lexer.token;
        if (token.kind === kind) {
            this._lexer.advance();
            return token;
        }
        throw syntaxError(this._lexer.source, token.start, `Expected ${getTokenKindDesc(kind)}, found ${getTokenDesc(token)}.`);
    }
    expectOptionalToken(kind) {
        const token = this._lexer.token;
        if (token.kind === kind) {
            this._lexer.advance();
            return token;
        }
        return undefined;
    }
    expectKeyword(value) {
        const token = this._lexer.token;
        if (token.kind === TokenKind.NAME && token.value === value) {
            this._lexer.advance();
        } else {
            throw syntaxError(this._lexer.source, token.start, `Expected "${value}", found ${getTokenDesc(token)}.`);
        }
    }
    expectOptionalKeyword(value) {
        const token = this._lexer.token;
        if (token.kind === TokenKind.NAME && token.value === value) {
            this._lexer.advance();
            return true;
        }
        return false;
    }
    unexpected(atToken) {
        const token = atToken ?? this._lexer.token;
        return syntaxError(this._lexer.source, token.start, `Unexpected ${getTokenDesc(token)}.`);
    }
    any(openKind, parseFn, closeKind) {
        this.expectToken(openKind);
        const nodes = [];
        while(!this.expectOptionalToken(closeKind)){
            nodes.push(parseFn.call(this));
        }
        return nodes;
    }
    optionalMany(openKind, parseFn, closeKind) {
        if (this.expectOptionalToken(openKind)) {
            const nodes = [];
            do {
                nodes.push(parseFn.call(this));
            }while (!this.expectOptionalToken(closeKind))
            return nodes;
        }
        return [];
    }
    many(openKind, parseFn, closeKind) {
        this.expectToken(openKind);
        const nodes = [];
        do {
            nodes.push(parseFn.call(this));
        }while (!this.expectOptionalToken(closeKind))
        return nodes;
    }
}
function getTokenDesc(token) {
    const value = token.value;
    return getTokenKindDesc(token.kind) + (value != null ? ` "${value}"` : '');
}
function getTokenKindDesc(kind) {
    return isPunctuatorTokenKind(kind) ? `"${kind}"` : kind;
}
const QueryDocumentKeys = {
    Name: [],
    Document: [
        'definitions'
    ],
    OperationDefinition: [
        'name',
        'variableDefinitions',
        'directives',
        'selectionSet'
    ],
    VariableDefinition: [
        'variable',
        'type',
        'defaultValue',
        'directives'
    ],
    Variable: [
        'name'
    ],
    SelectionSet: [
        'selections'
    ],
    Field: [
        'alias',
        'name',
        'arguments',
        'directives',
        'selectionSet'
    ],
    Argument: [
        'name',
        'value'
    ],
    FragmentSpread: [
        'name',
        'directives'
    ],
    InlineFragment: [
        'typeCondition',
        'directives',
        'selectionSet'
    ],
    FragmentDefinition: [
        'name',
        'variableDefinitions',
        'typeCondition',
        'directives',
        'selectionSet'
    ],
    IntValue: [],
    FloatValue: [],
    StringValue: [],
    BooleanValue: [],
    NullValue: [],
    EnumValue: [],
    ListValue: [
        'values'
    ],
    ObjectValue: [
        'fields'
    ],
    ObjectField: [
        'name',
        'value'
    ],
    Directive: [
        'name',
        'arguments'
    ],
    NamedType: [
        'name'
    ],
    ListType: [
        'type'
    ],
    NonNullType: [
        'type'
    ],
    SchemaDefinition: [
        'description',
        'directives',
        'operationTypes'
    ],
    OperationTypeDefinition: [
        'type'
    ],
    ScalarTypeDefinition: [
        'description',
        'name',
        'directives'
    ],
    ObjectTypeDefinition: [
        'description',
        'name',
        'interfaces',
        'directives',
        'fields'
    ],
    FieldDefinition: [
        'description',
        'name',
        'arguments',
        'type',
        'directives'
    ],
    InputValueDefinition: [
        'description',
        'name',
        'type',
        'defaultValue',
        'directives'
    ],
    InterfaceTypeDefinition: [
        'description',
        'name',
        'interfaces',
        'directives',
        'fields'
    ],
    UnionTypeDefinition: [
        'description',
        'name',
        'directives',
        'types'
    ],
    EnumTypeDefinition: [
        'description',
        'name',
        'directives',
        'values'
    ],
    EnumValueDefinition: [
        'description',
        'name',
        'directives'
    ],
    InputObjectTypeDefinition: [
        'description',
        'name',
        'directives',
        'fields'
    ],
    DirectiveDefinition: [
        'description',
        'name',
        'arguments',
        'locations'
    ],
    SchemaExtension: [
        'directives',
        'operationTypes'
    ],
    ScalarTypeExtension: [
        'name',
        'directives'
    ],
    ObjectTypeExtension: [
        'name',
        'interfaces',
        'directives',
        'fields'
    ],
    InterfaceTypeExtension: [
        'name',
        'interfaces',
        'directives',
        'fields'
    ],
    UnionTypeExtension: [
        'name',
        'directives',
        'types'
    ],
    EnumTypeExtension: [
        'name',
        'directives',
        'values'
    ],
    InputObjectTypeExtension: [
        'name',
        'directives',
        'fields'
    ]
};
const BREAK = Object.freeze({});
function visit(root, visitor, visitorKeys = QueryDocumentKeys) {
    let stack = undefined;
    let inArray = Array.isArray(root);
    let keys = [
        root
    ];
    let index = -1;
    let edits = [];
    let node = undefined;
    let key = undefined;
    let parent = undefined;
    const path = [];
    const ancestors = [];
    let newRoot = root;
    do {
        index++;
        const isLeaving = index === keys.length;
        const isEdited = isLeaving && edits.length !== 0;
        if (isLeaving) {
            key = ancestors.length === 0 ? undefined : path[path.length - 1];
            node = parent;
            parent = ancestors.pop();
            if (isEdited) {
                if (inArray) {
                    node = node.slice();
                } else {
                    const clone = {};
                    for (const k of Object.keys(node)){
                        clone[k] = node[k];
                    }
                    node = clone;
                }
                let editOffset = 0;
                for(let ii = 0; ii < edits.length; ii++){
                    let editKey = edits[ii][0];
                    const editValue = edits[ii][1];
                    if (inArray) {
                        editKey -= editOffset;
                    }
                    if (inArray && editValue === null) {
                        node.splice(editKey, 1);
                        editOffset++;
                    } else {
                        node[editKey] = editValue;
                    }
                }
            }
            index = stack.index;
            keys = stack.keys;
            edits = stack.edits;
            inArray = stack.inArray;
            stack = stack.prev;
        } else {
            key = parent ? inArray ? index : keys[index] : undefined;
            node = parent ? parent[key] : newRoot;
            if (node === null || node === undefined) {
                continue;
            }
            if (parent) {
                path.push(key);
            }
        }
        let result;
        if (!Array.isArray(node)) {
            if (!isNode(node)) {
                throw new Error(`Invalid AST Node: ${inspect(node)}.`);
            }
            const visitFn = getVisitFn(visitor, node.kind, isLeaving);
            if (visitFn) {
                result = visitFn.call(visitor, node, key, parent, path, ancestors);
                if (result === BREAK) {
                    break;
                }
                if (result === false) {
                    if (!isLeaving) {
                        path.pop();
                        continue;
                    }
                } else if (result !== undefined) {
                    edits.push([
                        key,
                        result
                    ]);
                    if (!isLeaving) {
                        if (isNode(result)) {
                            node = result;
                        } else {
                            path.pop();
                            continue;
                        }
                    }
                }
            }
        }
        if (result === undefined && isEdited) {
            edits.push([
                key,
                node
            ]);
        }
        if (isLeaving) {
            path.pop();
        } else {
            stack = {
                inArray,
                index,
                keys,
                edits,
                prev: stack
            };
            inArray = Array.isArray(node);
            keys = inArray ? node : visitorKeys[node.kind] ?? [];
            index = -1;
            edits = [];
            if (parent) {
                ancestors.push(parent);
            }
            parent = node;
        }
    }while (stack !== undefined)
    if (edits.length !== 0) {
        newRoot = edits[edits.length - 1][1];
    }
    return newRoot;
}
function visitInParallel(visitors) {
    const skipping = new Array(visitors.length);
    return {
        enter (node) {
            for(let i = 0; i < visitors.length; i++){
                if (skipping[i] == null) {
                    const fn = getVisitFn(visitors[i], node.kind, false);
                    if (fn) {
                        const result = fn.apply(visitors[i], arguments);
                        if (result === false) {
                            skipping[i] = node;
                        } else if (result === BREAK) {
                            skipping[i] = BREAK;
                        } else if (result !== undefined) {
                            return result;
                        }
                    }
                }
            }
        },
        leave (node) {
            for(let i = 0; i < visitors.length; i++){
                if (skipping[i] == null) {
                    const fn = getVisitFn(visitors[i], node.kind, true);
                    if (fn) {
                        const result = fn.apply(visitors[i], arguments);
                        if (result === BREAK) {
                            skipping[i] = BREAK;
                        } else if (result !== undefined && result !== false) {
                            return result;
                        }
                    }
                } else if (skipping[i] === node) {
                    skipping[i] = null;
                }
            }
        }
    };
}
function getVisitFn(visitor, kind, isLeaving) {
    const kindVisitor = visitor[kind];
    if (kindVisitor) {
        if (!isLeaving && typeof kindVisitor === 'function') {
            return kindVisitor;
        }
        const kindSpecificVisitor = isLeaving ? kindVisitor.leave : kindVisitor.enter;
        if (typeof kindSpecificVisitor === 'function') {
            return kindSpecificVisitor;
        }
    } else {
        const specificVisitor = isLeaving ? visitor.leave : visitor.enter;
        if (specificVisitor) {
            if (typeof specificVisitor === 'function') {
                return specificVisitor;
            }
            const specificKindVisitor = specificVisitor[kind];
            if (typeof specificKindVisitor === 'function') {
                return specificKindVisitor;
            }
        }
    }
}
const find = Array.prototype.find ? function(list, predicate) {
    return Array.prototype.find.call(list, predicate);
} : function(list, predicate) {
    for (const value of list){
        if (predicate(value)) {
            return value;
        }
    }
};
const flatMapMethod = Array.prototype.flatMap;
const flatMap = flatMapMethod ? function(list, fn) {
    return flatMapMethod.call(list, fn);
} : function(list, fn) {
    let result = [];
    for (const item of list){
        const value = fn(item);
        if (Array.isArray(value)) {
            result = result.concat(value);
        } else {
            result.push(value);
        }
    }
    return result;
};
const objectValues = Object.values || ((obj)=>Object.keys(obj).map((key)=>obj[key]
    )
);
function locatedError(originalError, nodes, path) {
    if (Array.isArray(originalError.path)) {
        return originalError;
    }
    return new GraphQLError(originalError.message, originalError.nodes ?? nodes, originalError.source, originalError.positions, path, originalError);
}
const NAME_RX = /^[_a-zA-Z][_a-zA-Z0-9]*$/;
function isValidNameError(name) {
    devAssert(typeof name === 'string', 'Expected name to be a string.');
    if (name.length > 1 && name[0] === '_' && name[1] === '_') {
        return new GraphQLError(`Name "${name}" must not begin with "__", which is reserved by GraphQL introspection.`);
    }
    if (!NAME_RX.test(name)) {
        return new GraphQLError(`Names must match /^[_a-zA-Z][_a-zA-Z0-9]*$/ but "${name}" does not.`);
    }
}
const objectEntries = Object.entries || ((obj)=>Object.keys(obj).map((key)=>[
            key,
            obj[key]
        ]
    )
);
function keyMap(list, keyFn) {
    return list.reduce((map, item)=>{
        map[keyFn(item)] = item;
        return map;
    }, Object.create(null));
}
function mapValue(map, fn) {
    const result = Object.create(null);
    for (const [key, value] of objectEntries(map)){
        result[key] = fn(value, key);
    }
    return result;
}
function toObjMap(obj) {
    if (Object.getPrototypeOf(obj) === null) {
        return obj;
    }
    const map = Object.create(null);
    for (const [key, value] of objectEntries(obj)){
        map[key] = value;
    }
    return map;
}
function keyValMap(list, keyFn, valFn) {
    return list.reduce((map, item)=>{
        map[keyFn(item)] = valFn(item);
        return map;
    }, Object.create(null));
}
const __default = Deno.env.NODE_ENV === 'production' ? function instanceOf(value, constructor) {
    return value instanceof constructor;
} : function instanceOf(value, constructor) {
    if (value instanceof constructor) {
        return true;
    }
    if (value) {
        const valueClass = value.constructor;
        const className = constructor.name;
        if (className && valueClass && valueClass.name === className) {
            throw new Error(`Cannot use ${className} "${value}" from another module or realm.

Ensure that there is only one instance of "graphql" in the node_modules
directory. If different versions of "graphql" are the dependencies of other
relied on modules, use "resolutions" to ensure only one version is installed.

https://yarnpkg.com/en/docs/selective-version-resolutions

Duplicate "graphql" modules cannot be used at the same time since different
versions may have different capabilities and behavior. The data from one
version used in the function from another could produce confusing and
spurious results.`);
        }
    }
    return false;
};
function didYouMean(firstArg, secondArg) {
    const [subMessage, suggestionsArg] = typeof firstArg === 'string' ? [
        firstArg,
        secondArg
    ] : [
        undefined,
        firstArg
    ];
    let message = ' Did you mean ';
    if (subMessage) {
        message += subMessage + ' ';
    }
    const suggestions = suggestionsArg.map((x)=>`"${x}"`
    );
    switch(suggestions.length){
        case 0:
            return '';
        case 1:
            return message + suggestions[0] + '?';
        case 2:
            return message + suggestions[0] + ' or ' + suggestions[1] + '?';
    }
    const selected = suggestions.slice(0, 5);
    const lastItem = selected.pop();
    return message + selected.join(', ') + ', or ' + lastItem + '?';
}
function identityFunc(x) {
    return x;
}
function suggestionList(input, options) {
    const optionsByDistance = Object.create(null);
    const lexicalDistance = new LexicalDistance(input);
    const threshold = Math.floor(input.length * 0.4) + 1;
    for (const option of options){
        const distance = lexicalDistance.measure(option, threshold);
        if (distance !== undefined) {
            optionsByDistance[option] = distance;
        }
    }
    return Object.keys(optionsByDistance).sort((a, b)=>{
        const distanceDiff = optionsByDistance[a] - optionsByDistance[b];
        return distanceDiff !== 0 ? distanceDiff : a.localeCompare(b);
    });
}
class LexicalDistance {
    constructor(input){
        this._input = input;
        this._inputLowerCase = input.toLowerCase();
        this._inputArray = stringToArray(this._inputLowerCase);
        this._rows = [
            new Array(input.length + 1).fill(0),
            new Array(input.length + 1).fill(0),
            new Array(input.length + 1).fill(0)
        ];
    }
    measure(option, threshold) {
        if (this._input === option) {
            return 0;
        }
        const optionLowerCase = option.toLowerCase();
        if (this._inputLowerCase === optionLowerCase) {
            return 1;
        }
        let a = stringToArray(optionLowerCase);
        let b = this._inputArray;
        if (a.length < b.length) {
            const tmp = a;
            a = b;
            b = tmp;
        }
        const aLength = a.length;
        const bLength = b.length;
        if (aLength - bLength > threshold) {
            return undefined;
        }
        const rows = this._rows;
        for(let j = 0; j <= bLength; j++){
            rows[0][j] = j;
        }
        for(let i = 1; i <= aLength; i++){
            const upRow = rows[(i - 1) % 3];
            const currentRow = rows[i % 3];
            let smallestCell = currentRow[0] = i;
            for(let j = 1; j <= bLength; j++){
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                let currentCell = Math.min(upRow[j] + 1, currentRow[j - 1] + 1, upRow[j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                    const doubleDiagonalCell = rows[(i - 2) % 3][j - 2];
                    currentCell = Math.min(currentCell, doubleDiagonalCell + 1);
                }
                if (currentCell < smallestCell) {
                    smallestCell = currentCell;
                }
                currentRow[j] = currentCell;
            }
            if (smallestCell > threshold) {
                return undefined;
            }
        }
        const distance = rows[aLength % 3][bLength];
        return distance <= threshold ? distance : undefined;
    }
}
function stringToArray(str) {
    const strLength = str.length;
    const array = new Array(strLength);
    for(let i = 0; i < strLength; ++i){
        array[i] = str.charCodeAt(i);
    }
    return array;
}
function print(ast) {
    return visit(ast, {
        leave: printDocASTReducer
    });
}
const printDocASTReducer = {
    Name: (node)=>node.value
    ,
    Variable: (node)=>'$' + node.name
    ,
    Document: (node)=>join(node.definitions, '\n\n') + '\n'
    ,
    OperationDefinition (node) {
        const op = node.operation;
        const name = node.name;
        const varDefs = wrap('(', join(node.variableDefinitions, ', '), ')');
        const directives = join(node.directives, ' ');
        const selectionSet = node.selectionSet;
        return !name && !directives && !varDefs && op === 'query' ? selectionSet : join([
            op,
            join([
                name,
                varDefs
            ]),
            directives,
            selectionSet
        ], ' ');
    },
    VariableDefinition: ({ variable , type , defaultValue , directives  })=>variable + ': ' + type + wrap(' = ', defaultValue) + wrap(' ', join(directives, ' '))
    ,
    SelectionSet: ({ selections  })=>block(selections)
    ,
    Field: ({ alias , name , arguments: args , directives , selectionSet  })=>join([
            wrap('', alias, ': ') + name + wrap('(', join(args, ', '), ')'),
            join(directives, ' '),
            selectionSet
        ], ' ')
    ,
    Argument: ({ name , value  })=>name + ': ' + value
    ,
    FragmentSpread: ({ name , directives  })=>'...' + name + wrap(' ', join(directives, ' '))
    ,
    InlineFragment: ({ typeCondition , directives , selectionSet  })=>join([
            '...',
            wrap('on ', typeCondition),
            join(directives, ' '),
            selectionSet
        ], ' ')
    ,
    FragmentDefinition: ({ name , typeCondition , variableDefinitions , directives , selectionSet  })=>`fragment ${name}${wrap('(', join(variableDefinitions, ', '), ')')} ` + `on ${typeCondition} ${wrap('', join(directives, ' '), ' ')}` + selectionSet
    ,
    IntValue: ({ value  })=>value
    ,
    FloatValue: ({ value  })=>value
    ,
    StringValue: ({ value , block: isBlockString  }, key)=>isBlockString ? printBlockString(value, key === 'description' ? '' : '  ') : JSON.stringify(value)
    ,
    BooleanValue: ({ value  })=>value ? 'true' : 'false'
    ,
    NullValue: ()=>'null'
    ,
    EnumValue: ({ value  })=>value
    ,
    ListValue: ({ values  })=>'[' + join(values, ', ') + ']'
    ,
    ObjectValue: ({ fields  })=>'{' + join(fields, ', ') + '}'
    ,
    ObjectField: ({ name , value  })=>name + ': ' + value
    ,
    Directive: ({ name , arguments: args  })=>'@' + name + wrap('(', join(args, ', '), ')')
    ,
    NamedType: ({ name  })=>name
    ,
    ListType: ({ type  })=>'[' + type + ']'
    ,
    NonNullType: ({ type  })=>type + '!'
    ,
    SchemaDefinition: addDescription(({ directives , operationTypes  })=>join([
            'schema',
            join(directives, ' '),
            block(operationTypes)
        ], ' ')
    ),
    OperationTypeDefinition: ({ operation , type  })=>operation + ': ' + type
    ,
    ScalarTypeDefinition: addDescription(({ name , directives  })=>join([
            'scalar',
            name,
            join(directives, ' ')
        ], ' ')
    ),
    ObjectTypeDefinition: addDescription(({ name , interfaces , directives , fields  })=>join([
            'type',
            name,
            wrap('implements ', join(interfaces, ' & ')),
            join(directives, ' '),
            block(fields)
        ], ' ')
    ),
    FieldDefinition: addDescription(({ name , arguments: args , type , directives  })=>name + (hasMultilineItems(args) ? wrap('(\n', indent(join(args, '\n')), '\n)') : wrap('(', join(args, ', '), ')')) + ': ' + type + wrap(' ', join(directives, ' '))
    ),
    InputValueDefinition: addDescription(({ name , type , defaultValue , directives  })=>join([
            name + ': ' + type,
            wrap('= ', defaultValue),
            join(directives, ' ')
        ], ' ')
    ),
    InterfaceTypeDefinition: addDescription(({ name , interfaces , directives , fields  })=>join([
            'interface',
            name,
            wrap('implements ', join(interfaces, ' & ')),
            join(directives, ' '),
            block(fields)
        ], ' ')
    ),
    UnionTypeDefinition: addDescription(({ name , directives , types  })=>join([
            'union',
            name,
            join(directives, ' '),
            types && types.length !== 0 ? '= ' + join(types, ' | ') : ''
        ], ' ')
    ),
    EnumTypeDefinition: addDescription(({ name , directives , values  })=>join([
            'enum',
            name,
            join(directives, ' '),
            block(values)
        ], ' ')
    ),
    EnumValueDefinition: addDescription(({ name , directives  })=>join([
            name,
            join(directives, ' ')
        ], ' ')
    ),
    InputObjectTypeDefinition: addDescription(({ name , directives , fields  })=>join([
            'input',
            name,
            join(directives, ' '),
            block(fields)
        ], ' ')
    ),
    DirectiveDefinition: addDescription(({ name , arguments: args , repeatable , locations  })=>'directive @' + name + (hasMultilineItems(args) ? wrap('(\n', indent(join(args, '\n')), '\n)') : wrap('(', join(args, ', '), ')')) + (repeatable ? ' repeatable' : '') + ' on ' + join(locations, ' | ')
    ),
    SchemaExtension: ({ directives , operationTypes  })=>join([
            'extend schema',
            join(directives, ' '),
            block(operationTypes)
        ], ' ')
    ,
    ScalarTypeExtension: ({ name , directives  })=>join([
            'extend scalar',
            name,
            join(directives, ' ')
        ], ' ')
    ,
    ObjectTypeExtension: ({ name , interfaces , directives , fields  })=>join([
            'extend type',
            name,
            wrap('implements ', join(interfaces, ' & ')),
            join(directives, ' '),
            block(fields)
        ], ' ')
    ,
    InterfaceTypeExtension: ({ name , interfaces , directives , fields  })=>join([
            'extend interface',
            name,
            wrap('implements ', join(interfaces, ' & ')),
            join(directives, ' '),
            block(fields)
        ], ' ')
    ,
    UnionTypeExtension: ({ name , directives , types  })=>join([
            'extend union',
            name,
            join(directives, ' '),
            types && types.length !== 0 ? '= ' + join(types, ' | ') : ''
        ], ' ')
    ,
    EnumTypeExtension: ({ name , directives , values  })=>join([
            'extend enum',
            name,
            join(directives, ' '),
            block(values)
        ], ' ')
    ,
    InputObjectTypeExtension: ({ name , directives , fields  })=>join([
            'extend input',
            name,
            join(directives, ' '),
            block(fields)
        ], ' ')
};
function addDescription(cb) {
    return (node)=>join([
            node.description,
            cb(node)
        ], '\n')
    ;
}
function join(maybeArray, separator = '') {
    return maybeArray?.filter((x)=>x
    ).join(separator) ?? '';
}
function block(array) {
    return array && array.length !== 0 ? '{\n' + indent(join(array, '\n')) + '\n}' : '';
}
function wrap(start, maybeString, end = '') {
    return maybeString ? start + maybeString + end : '';
}
function indent(maybeString) {
    return maybeString && '  ' + maybeString.replace(/\n/g, '\n  ');
}
function isMultiline(string) {
    return string.indexOf('\n') !== -1;
}
function hasMultilineItems(maybeArray) {
    return maybeArray && maybeArray.some(isMultiline);
}
function invariant(condition, message) {
    const booleanCondition = Boolean(condition);
    if (!booleanCondition) {
        throw new Error(message != null ? message : 'Unexpected invariant triggered.');
    }
}
function valueFromASTUntyped(valueNode, variables) {
    switch(valueNode.kind){
        case Kind.NULL:
            return null;
        case Kind.INT:
            return parseInt(valueNode.value, 10);
        case Kind.FLOAT:
            return parseFloat(valueNode.value);
        case Kind.STRING:
        case Kind.ENUM:
        case Kind.BOOLEAN:
            return valueNode.value;
        case Kind.LIST:
            return valueNode.values.map((node)=>valueFromASTUntyped(node, variables)
            );
        case Kind.OBJECT:
            return keyValMap(valueNode.fields, (field)=>field.name.value
            , (field)=>valueFromASTUntyped(field.value, variables)
            );
        case Kind.VARIABLE:
            return variables?.[valueNode.name.value];
    }
    invariant(false, 'Unexpected value node: ' + inspect(valueNode));
}
function isType(type) {
    return isScalarType(type) || isObjectType(type) || isInterfaceType(type) || isUnionType(type) || isEnumType(type) || isInputObjectType(type) || isListType(type) || isNonNullType(type);
}
function assertType(type) {
    if (!isType(type)) {
        throw new Error(`Expected ${inspect(type)} to be a GraphQL type.`);
    }
    return type;
}
function isScalarType(type) {
    return __default(type, GraphQLScalarType);
}
function isObjectType(type) {
    return __default(type, GraphQLObjectType);
}
function isInterfaceType(type) {
    return __default(type, GraphQLInterfaceType);
}
function isUnionType(type) {
    return __default(type, GraphQLUnionType);
}
function isEnumType(type) {
    return __default(type, GraphQLEnumType);
}
function isInputObjectType(type) {
    return __default(type, GraphQLInputObjectType);
}
function isListType(type) {
    return __default(type, GraphQLList);
}
function isNonNullType(type) {
    return __default(type, GraphQLNonNull);
}
function isInputType(type) {
    return isScalarType(type) || isEnumType(type) || isInputObjectType(type) || isWrappingType(type) && isInputType(type.ofType);
}
function isOutputType(type) {
    return isScalarType(type) || isObjectType(type) || isInterfaceType(type) || isUnionType(type) || isEnumType(type) || isWrappingType(type) && isOutputType(type.ofType);
}
function isLeafType(type) {
    return isScalarType(type) || isEnumType(type);
}
function isCompositeType(type) {
    return isObjectType(type) || isInterfaceType(type) || isUnionType(type);
}
function isAbstractType(type) {
    return isInterfaceType(type) || isUnionType(type);
}
function GraphQLList(ofType) {
    if (this instanceof GraphQLList) {
        this.ofType = assertType(ofType);
    } else {
        return new GraphQLList(ofType);
    }
}
GraphQLList.prototype.toString = function toString() {
    return '[' + String(this.ofType) + ']';
};
Object.defineProperty(GraphQLList.prototype, SYMBOL_TO_STRING_TAG, {
    get () {
        return 'GraphQLList';
    }
});
defineToJSON(GraphQLList);
function GraphQLNonNull(ofType) {
    if (this instanceof GraphQLNonNull) {
        this.ofType = assertNullableType(ofType);
    } else {
        return new GraphQLNonNull(ofType);
    }
}
GraphQLNonNull.prototype.toString = function toString() {
    return String(this.ofType) + '!';
};
Object.defineProperty(GraphQLNonNull.prototype, SYMBOL_TO_STRING_TAG, {
    get () {
        return 'GraphQLNonNull';
    }
});
defineToJSON(GraphQLNonNull);
function isWrappingType(type) {
    return isListType(type) || isNonNullType(type);
}
function isNullableType(type) {
    return isType(type) && !isNonNullType(type);
}
function assertNullableType(type) {
    if (!isNullableType(type)) {
        throw new Error(`Expected ${inspect(type)} to be a GraphQL nullable type.`);
    }
    return type;
}
function getNullableType(type) {
    if (type) {
        return isNonNullType(type) ? type.ofType : type;
    }
}
function isNamedType(type) {
    return isScalarType(type) || isObjectType(type) || isInterfaceType(type) || isUnionType(type) || isEnumType(type) || isInputObjectType(type);
}
function getNamedType(type) {
    if (type) {
        let unwrappedType = type;
        while(isWrappingType(unwrappedType)){
            unwrappedType = unwrappedType.ofType;
        }
        return unwrappedType;
    }
}
function resolveThunk(thunk) {
    return typeof thunk === 'function' ? thunk() : thunk;
}
function undefineIfEmpty(arr) {
    return arr && arr.length > 0 ? arr : undefined;
}
class GraphQLScalarType {
    constructor(config){
        const parseValue = config.parseValue ?? identityFunc;
        this.name = config.name;
        this.description = config.description;
        this.serialize = config.serialize ?? identityFunc;
        this.parseValue = parseValue;
        this.parseLiteral = config.parseLiteral ?? ((node)=>parseValue(valueFromASTUntyped(node))
        );
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        this.extensionASTNodes = undefineIfEmpty(config.extensionASTNodes);
        devAssert(typeof config.name === 'string', 'Must provide name.');
        devAssert(config.serialize == null || typeof config.serialize === 'function', `${this.name} must provide "serialize" function. If this custom Scalar is also used as an input type, ensure "parseValue" and "parseLiteral" functions are also provided.`);
        if (config.parseLiteral) {
            devAssert(typeof config.parseValue === 'function' && typeof config.parseLiteral === 'function', `${this.name} must provide both "parseValue" and "parseLiteral" functions.`);
        }
    }
    toConfig() {
        return {
            name: this.name,
            description: this.description,
            serialize: this.serialize,
            parseValue: this.parseValue,
            parseLiteral: this.parseLiteral,
            extensions: this.extensions,
            astNode: this.astNode,
            extensionASTNodes: this.extensionASTNodes ?? []
        };
    }
    toString() {
        return this.name;
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLScalarType';
    }
}
defineToJSON(GraphQLScalarType);
class GraphQLObjectType {
    constructor(config){
        this.name = config.name;
        this.description = config.description;
        this.isTypeOf = config.isTypeOf;
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        this.extensionASTNodes = undefineIfEmpty(config.extensionASTNodes);
        this._fields = defineFieldMap.bind(undefined, config);
        this._interfaces = defineInterfaces.bind(undefined, config);
        devAssert(typeof config.name === 'string', 'Must provide name.');
        devAssert(config.isTypeOf == null || typeof config.isTypeOf === 'function', `${this.name} must provide "isTypeOf" as a function, ` + `but got: ${inspect(config.isTypeOf)}.`);
    }
    getFields() {
        if (typeof this._fields === 'function') {
            this._fields = this._fields();
        }
        return this._fields;
    }
    getInterfaces() {
        if (typeof this._interfaces === 'function') {
            this._interfaces = this._interfaces();
        }
        return this._interfaces;
    }
    toConfig() {
        return {
            name: this.name,
            description: this.description,
            interfaces: this.getInterfaces(),
            fields: fieldsToFieldsConfig(this.getFields()),
            isTypeOf: this.isTypeOf,
            extensions: this.extensions,
            astNode: this.astNode,
            extensionASTNodes: this.extensionASTNodes || []
        };
    }
    toString() {
        return this.name;
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLObjectType';
    }
}
defineToJSON(GraphQLObjectType);
function defineInterfaces(config) {
    const interfaces = resolveThunk(config.interfaces) ?? [];
    devAssert(Array.isArray(interfaces), `${config.name} interfaces must be an Array or a function which returns an Array.`);
    return interfaces;
}
function defineFieldMap(config) {
    const fieldMap = resolveThunk(config.fields);
    devAssert(isPlainObj(fieldMap), `${config.name} fields must be an object with field names as keys or a function which returns such an object.`);
    return mapValue(fieldMap, (fieldConfig, fieldName)=>{
        devAssert(isPlainObj(fieldConfig), `${config.name}.${fieldName} field config must be an object.`);
        devAssert(!('isDeprecated' in fieldConfig), `${config.name}.${fieldName} should provide "deprecationReason" instead of "isDeprecated".`);
        devAssert(fieldConfig.resolve == null || typeof fieldConfig.resolve === 'function', `${config.name}.${fieldName} field resolver must be a function if ` + `provided, but got: ${inspect(fieldConfig.resolve)}.`);
        const argsConfig = fieldConfig.args ?? {};
        devAssert(isPlainObj(argsConfig), `${config.name}.${fieldName} args must be an object with argument names as keys.`);
        const args = objectEntries(argsConfig).map(([argName, argConfig])=>({
                name: argName,
                description: argConfig.description,
                type: argConfig.type,
                defaultValue: argConfig.defaultValue,
                extensions: argConfig.extensions && toObjMap(argConfig.extensions),
                astNode: argConfig.astNode
            })
        );
        return {
            name: fieldName,
            description: fieldConfig.description,
            type: fieldConfig.type,
            args,
            resolve: fieldConfig.resolve,
            subscribe: fieldConfig.subscribe,
            isDeprecated: fieldConfig.deprecationReason != null,
            deprecationReason: fieldConfig.deprecationReason,
            extensions: fieldConfig.extensions && toObjMap(fieldConfig.extensions),
            astNode: fieldConfig.astNode
        };
    });
}
function isPlainObj(obj) {
    return isObjectLike(obj) && !Array.isArray(obj);
}
function fieldsToFieldsConfig(fields) {
    return mapValue(fields, (field)=>({
            description: field.description,
            type: field.type,
            args: argsToArgsConfig(field.args),
            resolve: field.resolve,
            subscribe: field.subscribe,
            deprecationReason: field.deprecationReason,
            extensions: field.extensions,
            astNode: field.astNode
        })
    );
}
function argsToArgsConfig(args) {
    return keyValMap(args, (arg)=>arg.name
    , (arg)=>({
            description: arg.description,
            type: arg.type,
            defaultValue: arg.defaultValue,
            extensions: arg.extensions,
            astNode: arg.astNode
        })
    );
}
function isRequiredArgument(arg) {
    return isNonNullType(arg.type) && arg.defaultValue === undefined;
}
class GraphQLInterfaceType {
    constructor(config){
        this.name = config.name;
        this.description = config.description;
        this.resolveType = config.resolveType;
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        this.extensionASTNodes = undefineIfEmpty(config.extensionASTNodes);
        this._fields = defineFieldMap.bind(undefined, config);
        this._interfaces = defineInterfaces.bind(undefined, config);
        devAssert(typeof config.name === 'string', 'Must provide name.');
        devAssert(config.resolveType == null || typeof config.resolveType === 'function', `${this.name} must provide "resolveType" as a function, ` + `but got: ${inspect(config.resolveType)}.`);
    }
    getFields() {
        if (typeof this._fields === 'function') {
            this._fields = this._fields();
        }
        return this._fields;
    }
    getInterfaces() {
        if (typeof this._interfaces === 'function') {
            this._interfaces = this._interfaces();
        }
        return this._interfaces;
    }
    toConfig() {
        return {
            name: this.name,
            description: this.description,
            interfaces: this.getInterfaces(),
            fields: fieldsToFieldsConfig(this.getFields()),
            resolveType: this.resolveType,
            extensions: this.extensions,
            astNode: this.astNode,
            extensionASTNodes: this.extensionASTNodes ?? []
        };
    }
    toString() {
        return this.name;
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLInterfaceType';
    }
}
defineToJSON(GraphQLInterfaceType);
class GraphQLUnionType {
    constructor(config){
        this.name = config.name;
        this.description = config.description;
        this.resolveType = config.resolveType;
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        this.extensionASTNodes = undefineIfEmpty(config.extensionASTNodes);
        this._types = defineTypes.bind(undefined, config);
        devAssert(typeof config.name === 'string', 'Must provide name.');
        devAssert(config.resolveType == null || typeof config.resolveType === 'function', `${this.name} must provide "resolveType" as a function, ` + `but got: ${inspect(config.resolveType)}.`);
    }
    getTypes() {
        if (typeof this._types === 'function') {
            this._types = this._types();
        }
        return this._types;
    }
    toConfig() {
        return {
            name: this.name,
            description: this.description,
            types: this.getTypes(),
            resolveType: this.resolveType,
            extensions: this.extensions,
            astNode: this.astNode,
            extensionASTNodes: this.extensionASTNodes ?? []
        };
    }
    toString() {
        return this.name;
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLUnionType';
    }
}
defineToJSON(GraphQLUnionType);
function defineTypes(config) {
    const types = resolveThunk(config.types);
    devAssert(Array.isArray(types), `Must provide Array of types or a function which returns such an array for Union ${config.name}.`);
    return types;
}
class GraphQLEnumType {
    constructor(config){
        this.name = config.name;
        this.description = config.description;
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        this.extensionASTNodes = undefineIfEmpty(config.extensionASTNodes);
        this._values = defineEnumValues(this.name, config.values);
        this._valueLookup = new Map(this._values.map((enumValue)=>[
                enumValue.value,
                enumValue
            ]
        ));
        this._nameLookup = keyMap(this._values, (value)=>value.name
        );
        devAssert(typeof config.name === 'string', 'Must provide name.');
    }
    getValues() {
        return this._values;
    }
    getValue(name) {
        return this._nameLookup[name];
    }
    serialize(outputValue) {
        const enumValue = this._valueLookup.get(outputValue);
        if (enumValue === undefined) {
            throw new GraphQLError(`Enum "${this.name}" cannot represent value: ${inspect(outputValue)}`);
        }
        return enumValue.name;
    }
    parseValue(inputValue) {
        if (typeof inputValue !== 'string') {
            const valueStr = inspect(inputValue);
            throw new GraphQLError(`Enum "${this.name}" cannot represent non-string value: ${valueStr}.` + didYouMeanEnumValue(this, valueStr));
        }
        const enumValue = this.getValue(inputValue);
        if (enumValue == null) {
            throw new GraphQLError(`Value "${inputValue}" does not exist in "${this.name}" enum.` + didYouMeanEnumValue(this, inputValue));
        }
        return enumValue.value;
    }
    parseLiteral(valueNode, _variables) {
        if (valueNode.kind !== Kind.ENUM) {
            const valueStr = print(valueNode);
            throw new GraphQLError(`Enum "${this.name}" cannot represent non-enum value: ${valueStr}.` + didYouMeanEnumValue(this, valueStr), valueNode);
        }
        const enumValue = this.getValue(valueNode.value);
        if (enumValue == null) {
            const valueStr = print(valueNode);
            throw new GraphQLError(`Value "${valueStr}" does not exist in "${this.name}" enum.` + didYouMeanEnumValue(this, valueStr), valueNode);
        }
        return enumValue.value;
    }
    toConfig() {
        const values = keyValMap(this.getValues(), (value)=>value.name
        , (value)=>({
                description: value.description,
                value: value.value,
                deprecationReason: value.deprecationReason,
                extensions: value.extensions,
                astNode: value.astNode
            })
        );
        return {
            name: this.name,
            description: this.description,
            values,
            extensions: this.extensions,
            astNode: this.astNode,
            extensionASTNodes: this.extensionASTNodes ?? []
        };
    }
    toString() {
        return this.name;
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLEnumType';
    }
}
defineToJSON(GraphQLEnumType);
function didYouMeanEnumValue(enumType, unknownValueStr) {
    const allNames = enumType.getValues().map((value)=>value.name
    );
    const suggestedValues = suggestionList(unknownValueStr, allNames);
    return didYouMean('the enum value', suggestedValues);
}
function defineEnumValues(typeName, valueMap) {
    devAssert(isPlainObj(valueMap), `${typeName} values must be an object with value names as keys.`);
    return objectEntries(valueMap).map(([valueName, valueConfig])=>{
        devAssert(isPlainObj(valueConfig), `${typeName}.${valueName} must refer to an object with a "value" key ` + `representing an internal value but got: ${inspect(valueConfig)}.`);
        devAssert(!('isDeprecated' in valueConfig), `${typeName}.${valueName} should provide "deprecationReason" instead of "isDeprecated".`);
        return {
            name: valueName,
            description: valueConfig.description,
            value: valueConfig.value !== undefined ? valueConfig.value : valueName,
            isDeprecated: valueConfig.deprecationReason != null,
            deprecationReason: valueConfig.deprecationReason,
            extensions: valueConfig.extensions && toObjMap(valueConfig.extensions),
            astNode: valueConfig.astNode
        };
    });
}
class GraphQLInputObjectType {
    constructor(config){
        this.name = config.name;
        this.description = config.description;
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        this.extensionASTNodes = undefineIfEmpty(config.extensionASTNodes);
        this._fields = defineInputFieldMap.bind(undefined, config);
        devAssert(typeof config.name === 'string', 'Must provide name.');
    }
    getFields() {
        if (typeof this._fields === 'function') {
            this._fields = this._fields();
        }
        return this._fields;
    }
    toConfig() {
        const fields = mapValue(this.getFields(), (field)=>({
                description: field.description,
                type: field.type,
                defaultValue: field.defaultValue,
                extensions: field.extensions,
                astNode: field.astNode
            })
        );
        return {
            name: this.name,
            description: this.description,
            fields,
            extensions: this.extensions,
            astNode: this.astNode,
            extensionASTNodes: this.extensionASTNodes ?? []
        };
    }
    toString() {
        return this.name;
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLInputObjectType';
    }
}
defineToJSON(GraphQLInputObjectType);
function defineInputFieldMap(config) {
    const fieldMap = resolveThunk(config.fields);
    devAssert(isPlainObj(fieldMap), `${config.name} fields must be an object with field names as keys or a function which returns such an object.`);
    return mapValue(fieldMap, (fieldConfig, fieldName)=>{
        devAssert(!('resolve' in fieldConfig), `${config.name}.${fieldName} field has a resolve property, but Input Types cannot define resolvers.`);
        return {
            name: fieldName,
            description: fieldConfig.description,
            type: fieldConfig.type,
            defaultValue: fieldConfig.defaultValue,
            extensions: fieldConfig.extensions && toObjMap(fieldConfig.extensions),
            astNode: fieldConfig.astNode
        };
    });
}
function isRequiredInputField(field) {
    return isNonNullType(field.type) && field.defaultValue === undefined;
}
function isEqualType(typeA, typeB) {
    if (typeA === typeB) {
        return true;
    }
    if (isNonNullType(typeA) && isNonNullType(typeB)) {
        return isEqualType(typeA.ofType, typeB.ofType);
    }
    if (isListType(typeA) && isListType(typeB)) {
        return isEqualType(typeA.ofType, typeB.ofType);
    }
    return false;
}
function isTypeSubTypeOf(schema, maybeSubType, superType) {
    if (maybeSubType === superType) {
        return true;
    }
    if (isNonNullType(superType)) {
        if (isNonNullType(maybeSubType)) {
            return isTypeSubTypeOf(schema, maybeSubType.ofType, superType.ofType);
        }
        return false;
    }
    if (isNonNullType(maybeSubType)) {
        return isTypeSubTypeOf(schema, maybeSubType.ofType, superType);
    }
    if (isListType(superType)) {
        if (isListType(maybeSubType)) {
            return isTypeSubTypeOf(schema, maybeSubType.ofType, superType.ofType);
        }
        return false;
    }
    if (isListType(maybeSubType)) {
        return false;
    }
    return isAbstractType(superType) && (isInterfaceType(maybeSubType) || isObjectType(maybeSubType)) && schema.isSubType(superType, maybeSubType);
}
function doTypesOverlap(schema, typeA, typeB) {
    if (typeA === typeB) {
        return true;
    }
    if (isAbstractType(typeA)) {
        if (isAbstractType(typeB)) {
            return schema.getPossibleTypes(typeA).some((type)=>schema.isSubType(typeB, type)
            );
        }
        return schema.isSubType(typeA, typeB);
    }
    if (isAbstractType(typeB)) {
        return schema.isSubType(typeB, typeA);
    }
    return false;
}
const isFinitePolyfill = Number.isFinite || function(value) {
    return typeof value === 'number' && isFinite(value);
};
const isInteger = Number.isInteger || function(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
};
const MIN_INT = -2147483648;
function serializeInt(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === 'boolean') {
        return coercedValue ? 1 : 0;
    }
    let num = coercedValue;
    if (typeof coercedValue === 'string' && coercedValue !== '') {
        num = Number(coercedValue);
    }
    if (!isInteger(num)) {
        throw new GraphQLError(`Int cannot represent non-integer value: ${inspect(coercedValue)}`);
    }
    if (num > 2147483647 || num < MIN_INT) {
        throw new GraphQLError('Int cannot represent non 32-bit signed integer value: ' + inspect(coercedValue));
    }
    return num;
}
function coerceInt(inputValue) {
    if (!isInteger(inputValue)) {
        throw new GraphQLError(`Int cannot represent non-integer value: ${inspect(inputValue)}`);
    }
    if (inputValue > 2147483647 || inputValue < MIN_INT) {
        throw new GraphQLError(`Int cannot represent non 32-bit signed integer value: ${inputValue}`);
    }
    return inputValue;
}
const GraphQLInt = new GraphQLScalarType({
    name: 'Int',
    description: 'The `Int` scalar type represents non-fractional signed whole numeric values. Int can represent values between -(2^31) and 2^31 - 1.',
    serialize: serializeInt,
    parseValue: coerceInt,
    parseLiteral (valueNode) {
        if (valueNode.kind !== Kind.INT) {
            throw new GraphQLError(`Int cannot represent non-integer value: ${print(valueNode)}`, valueNode);
        }
        const num = parseInt(valueNode.value, 10);
        if (num > 2147483647 || num < MIN_INT) {
            throw new GraphQLError(`Int cannot represent non 32-bit signed integer value: ${valueNode.value}`, valueNode);
        }
        return num;
    }
});
function serializeFloat(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === 'boolean') {
        return coercedValue ? 1 : 0;
    }
    let num = coercedValue;
    if (typeof coercedValue === 'string' && coercedValue !== '') {
        num = Number(coercedValue);
    }
    if (!isFinitePolyfill(num)) {
        throw new GraphQLError(`Float cannot represent non numeric value: ${inspect(coercedValue)}`);
    }
    return num;
}
function coerceFloat(inputValue) {
    if (!isFinitePolyfill(inputValue)) {
        throw new GraphQLError(`Float cannot represent non numeric value: ${inspect(inputValue)}`);
    }
    return inputValue;
}
const GraphQLFloat = new GraphQLScalarType({
    name: 'Float',
    description: 'The `Float` scalar type represents signed double-precision fractional values as specified by [IEEE 754](https://en.wikipedia.org/wiki/IEEE_floating_point).',
    serialize: serializeFloat,
    parseValue: coerceFloat,
    parseLiteral (valueNode) {
        if (valueNode.kind !== Kind.FLOAT && valueNode.kind !== Kind.INT) {
            throw new GraphQLError(`Float cannot represent non numeric value: ${print(valueNode)}`, valueNode);
        }
        return parseFloat(valueNode.value);
    }
});
function serializeObject(outputValue) {
    if (isObjectLike(outputValue)) {
        if (typeof outputValue.valueOf === 'function') {
            const valueOfResult = outputValue.valueOf();
            if (!isObjectLike(valueOfResult)) {
                return valueOfResult;
            }
        }
        if (typeof outputValue.toJSON === 'function') {
            return outputValue.toJSON();
        }
    }
    return outputValue;
}
function serializeString(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === 'string') {
        return coercedValue;
    }
    if (typeof coercedValue === 'boolean') {
        return coercedValue ? 'true' : 'false';
    }
    if (isFinitePolyfill(coercedValue)) {
        return coercedValue.toString();
    }
    throw new GraphQLError(`String cannot represent value: ${inspect(outputValue)}`);
}
function coerceString(inputValue) {
    if (typeof inputValue !== 'string') {
        throw new GraphQLError(`String cannot represent a non string value: ${inspect(inputValue)}`);
    }
    return inputValue;
}
const GraphQLString = new GraphQLScalarType({
    name: 'String',
    description: 'The `String` scalar type represents textual data, represented as UTF-8 character sequences. The String type is most often used by GraphQL to represent free-form human-readable text.',
    serialize: serializeString,
    parseValue: coerceString,
    parseLiteral (valueNode) {
        if (valueNode.kind !== Kind.STRING) {
            throw new GraphQLError(`String cannot represent a non string value: ${print(valueNode)}`, valueNode);
        }
        return valueNode.value;
    }
});
function serializeBoolean(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === 'boolean') {
        return coercedValue;
    }
    if (isFinitePolyfill(coercedValue)) {
        return coercedValue !== 0;
    }
    throw new GraphQLError(`Boolean cannot represent a non boolean value: ${inspect(coercedValue)}`);
}
function coerceBoolean(inputValue) {
    if (typeof inputValue !== 'boolean') {
        throw new GraphQLError(`Boolean cannot represent a non boolean value: ${inspect(inputValue)}`);
    }
    return inputValue;
}
const GraphQLBoolean = new GraphQLScalarType({
    name: 'Boolean',
    description: 'The `Boolean` scalar type represents `true` or `false`.',
    serialize: serializeBoolean,
    parseValue: coerceBoolean,
    parseLiteral (valueNode) {
        if (valueNode.kind !== Kind.BOOLEAN) {
            throw new GraphQLError(`Boolean cannot represent a non boolean value: ${print(valueNode)}`, valueNode);
        }
        return valueNode.value;
    }
});
function serializeID(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === 'string') {
        return coercedValue;
    }
    if (isInteger(coercedValue)) {
        return String(coercedValue);
    }
    throw new GraphQLError(`ID cannot represent value: ${inspect(outputValue)}`);
}
function coerceID(inputValue) {
    if (typeof inputValue === 'string') {
        return inputValue;
    }
    if (isInteger(inputValue)) {
        return inputValue.toString();
    }
    throw new GraphQLError(`ID cannot represent value: ${inspect(inputValue)}`);
}
const GraphQLID = new GraphQLScalarType({
    name: 'ID',
    description: 'The `ID` scalar type represents a unique identifier, often used to refetch an object or as key for a cache. The ID type appears in a JSON response as a String; however, it is not intended to be human-readable. When expected as an input type, any string (such as `"4"`) or integer (such as `4`) input value will be accepted as an ID.',
    serialize: serializeID,
    parseValue: coerceID,
    parseLiteral (valueNode) {
        if (valueNode.kind !== Kind.STRING && valueNode.kind !== Kind.INT) {
            throw new GraphQLError('ID cannot represent a non-string and non-integer value: ' + print(valueNode), valueNode);
        }
        return valueNode.value;
    }
});
const specifiedScalarTypes = Object.freeze([
    GraphQLString,
    GraphQLInt,
    GraphQLFloat,
    GraphQLBoolean,
    GraphQLID
]);
function isSpecifiedScalarType(type) {
    return specifiedScalarTypes.some(({ name  })=>type.name === name
    );
}
function isDirective(directive) {
    return __default(directive, GraphQLDirective);
}
class GraphQLDirective {
    constructor(config){
        this.name = config.name;
        this.description = config.description;
        this.locations = config.locations;
        this.isRepeatable = config.isRepeatable ?? false;
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        devAssert(config.name, 'Directive must be named.');
        devAssert(Array.isArray(config.locations), `@${config.name} locations must be an Array.`);
        const args = config.args ?? {};
        devAssert(isObjectLike(args) && !Array.isArray(args), `@${config.name} args must be an object with argument names as keys.`);
        this.args = objectEntries(args).map(([argName, argConfig])=>({
                name: argName,
                description: argConfig.description,
                type: argConfig.type,
                defaultValue: argConfig.defaultValue,
                extensions: argConfig.extensions && toObjMap(argConfig.extensions),
                astNode: argConfig.astNode
            })
        );
    }
    toConfig() {
        return {
            name: this.name,
            description: this.description,
            locations: this.locations,
            args: argsToArgsConfig(this.args),
            isRepeatable: this.isRepeatable,
            extensions: this.extensions,
            astNode: this.astNode
        };
    }
    toString() {
        return '@' + this.name;
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLDirective';
    }
}
defineToJSON(GraphQLDirective);
const GraphQLIncludeDirective = new GraphQLDirective({
    name: 'include',
    description: 'Directs the executor to include this field or fragment only when the `if` argument is true.',
    locations: [
        DirectiveLocation.FIELD,
        DirectiveLocation.FRAGMENT_SPREAD,
        DirectiveLocation.INLINE_FRAGMENT
    ],
    args: {
        if: {
            type: GraphQLNonNull(GraphQLBoolean),
            description: 'Included when true.'
        }
    }
});
const GraphQLSkipDirective = new GraphQLDirective({
    name: 'skip',
    description: 'Directs the executor to skip this field or fragment when the `if` argument is true.',
    locations: [
        DirectiveLocation.FIELD,
        DirectiveLocation.FRAGMENT_SPREAD,
        DirectiveLocation.INLINE_FRAGMENT
    ],
    args: {
        if: {
            type: GraphQLNonNull(GraphQLBoolean),
            description: 'Skipped when true.'
        }
    }
});
const DEFAULT_DEPRECATION_REASON = 'No longer supported';
const GraphQLDeprecatedDirective = new GraphQLDirective({
    name: 'deprecated',
    description: 'Marks an element of a GraphQL schema as no longer supported.',
    locations: [
        DirectiveLocation.FIELD_DEFINITION,
        DirectiveLocation.ENUM_VALUE
    ],
    args: {
        reason: {
            type: GraphQLString,
            description: 'Explains why this element was deprecated, usually also including a suggestion for how to access supported similar data. Formatted using the Markdown syntax, as specified by [CommonMark](https://commonmark.org/).',
            defaultValue: DEFAULT_DEPRECATION_REASON
        }
    }
});
const specifiedDirectives = Object.freeze([
    GraphQLIncludeDirective,
    GraphQLSkipDirective,
    GraphQLDeprecatedDirective
]);
const arrayFrom = Array.from || function(obj, mapFn, thisArg) {
    if (obj == null) {
        throw new TypeError('Array.from requires an array-like object - not null or undefined');
    }
    const iteratorMethod = obj[SYMBOL_ITERATOR];
    if (typeof iteratorMethod === 'function') {
        const iterator = iteratorMethod.call(obj);
        const result = [];
        let step;
        for(let i = 0; !(step = iterator.next()).done; ++i){
            result.push(mapFn.call(thisArg, step.value, i));
            if (i > 9999999) {
                throw new TypeError('Near-infinite iteration.');
            }
        }
        return result;
    }
    const length = obj.length;
    if (typeof length === 'number' && length >= 0 && length % 1 === 0) {
        const result = [];
        for(let i = 0; i < length; ++i){
            if (Object.prototype.hasOwnProperty.call(obj, i)) {
                result.push(mapFn.call(thisArg, obj[i], i));
            }
        }
        return result;
    }
    return [];
};
function isCollection(obj) {
    if (obj == null || typeof obj !== 'object') {
        return false;
    }
    const length = obj.length;
    if (typeof length === 'number' && length >= 0 && length % 1 === 0) {
        return true;
    }
    return typeof obj[SYMBOL_ITERATOR] === 'function';
}
function astFromValue(value, type) {
    if (isNonNullType(type)) {
        const astValue = astFromValue(value, type.ofType);
        if (astValue?.kind === Kind.NULL) {
            return null;
        }
        return astValue;
    }
    if (value === null) {
        return {
            kind: Kind.NULL
        };
    }
    if (value === undefined) {
        return null;
    }
    if (isListType(type)) {
        const itemType = type.ofType;
        if (isCollection(value)) {
            const valuesNodes = [];
            for (const item of arrayFrom(value)){
                const itemNode = astFromValue(item, itemType);
                if (itemNode != null) {
                    valuesNodes.push(itemNode);
                }
            }
            return {
                kind: Kind.LIST,
                values: valuesNodes
            };
        }
        return astFromValue(value, itemType);
    }
    if (isInputObjectType(type)) {
        if (!isObjectLike(value)) {
            return null;
        }
        const fieldNodes = [];
        for (const field of objectValues(type.getFields())){
            const fieldValue = astFromValue(value[field.name], field.type);
            if (fieldValue) {
                fieldNodes.push({
                    kind: Kind.OBJECT_FIELD,
                    name: {
                        kind: Kind.NAME,
                        value: field.name
                    },
                    value: fieldValue
                });
            }
        }
        return {
            kind: Kind.OBJECT,
            fields: fieldNodes
        };
    }
    if (isLeafType(type)) {
        const serialized = type.serialize(value);
        if (serialized == null) {
            return null;
        }
        if (typeof serialized === 'boolean') {
            return {
                kind: Kind.BOOLEAN,
                value: serialized
            };
        }
        if (typeof serialized === 'number' && isFinitePolyfill(serialized)) {
            const stringNum = String(serialized);
            return integerStringRegExp.test(stringNum) ? {
                kind: Kind.INT,
                value: stringNum
            } : {
                kind: Kind.FLOAT,
                value: stringNum
            };
        }
        if (typeof serialized === 'string') {
            if (isEnumType(type)) {
                return {
                    kind: Kind.ENUM,
                    value: serialized
                };
            }
            if (type === GraphQLID && integerStringRegExp.test(serialized)) {
                return {
                    kind: Kind.INT,
                    value: serialized
                };
            }
            return {
                kind: Kind.STRING,
                value: serialized
            };
        }
        throw new TypeError(`Cannot convert value to AST: ${inspect(serialized)}.`);
    }
    invariant(false, 'Unexpected input type: ' + inspect(type));
}
const integerStringRegExp = /^-?(?:0|[1-9][0-9]*)$/;
const __Schema = new GraphQLObjectType({
    name: '__Schema',
    description: 'A GraphQL Schema defines the capabilities of a GraphQL server. It exposes all available types and directives on the server, as well as the entry points for query, mutation, and subscription operations.',
    fields: ()=>({
            description: {
                type: GraphQLString,
                resolve: (schema)=>schema.description
            },
            types: {
                description: 'A list of all types supported by this server.',
                type: GraphQLNonNull(GraphQLList(GraphQLNonNull(__Type))),
                resolve (schema) {
                    return objectValues(schema.getTypeMap());
                }
            },
            queryType: {
                description: 'The type that query operations will be rooted at.',
                type: GraphQLNonNull(__Type),
                resolve: (schema)=>schema.getQueryType()
            },
            mutationType: {
                description: 'If this server supports mutation, the type that mutation operations will be rooted at.',
                type: __Type,
                resolve: (schema)=>schema.getMutationType()
            },
            subscriptionType: {
                description: 'If this server support subscription, the type that subscription operations will be rooted at.',
                type: __Type,
                resolve: (schema)=>schema.getSubscriptionType()
            },
            directives: {
                description: 'A list of all directives supported by this server.',
                type: GraphQLNonNull(GraphQLList(GraphQLNonNull(__Directive))),
                resolve: (schema)=>schema.getDirectives()
            }
        })
});
const __Directive = new GraphQLObjectType({
    name: '__Directive',
    description: "A Directive provides a way to describe alternate runtime execution and type validation behavior in a GraphQL document.\n\nIn some cases, you need to provide options to alter GraphQL's execution behavior in ways field arguments will not suffice, such as conditionally including or skipping a field. Directives provide this by describing additional information to the executor.",
    fields: ()=>({
            name: {
                type: GraphQLNonNull(GraphQLString),
                resolve: (directive)=>directive.name
            },
            description: {
                type: GraphQLString,
                resolve: (directive)=>directive.description
            },
            isRepeatable: {
                type: GraphQLNonNull(GraphQLBoolean),
                resolve: (directive)=>directive.isRepeatable
            },
            locations: {
                type: GraphQLNonNull(GraphQLList(GraphQLNonNull(__DirectiveLocation))),
                resolve: (directive)=>directive.locations
            },
            args: {
                type: GraphQLNonNull(GraphQLList(GraphQLNonNull(__InputValue))),
                resolve: (directive)=>directive.args
            }
        })
});
const __DirectiveLocation = new GraphQLEnumType({
    name: '__DirectiveLocation',
    description: 'A Directive can be adjacent to many parts of the GraphQL language, a __DirectiveLocation describes one such possible adjacencies.',
    values: {
        QUERY: {
            value: DirectiveLocation.QUERY,
            description: 'Location adjacent to a query operation.'
        },
        MUTATION: {
            value: DirectiveLocation.MUTATION,
            description: 'Location adjacent to a mutation operation.'
        },
        SUBSCRIPTION: {
            value: DirectiveLocation.SUBSCRIPTION,
            description: 'Location adjacent to a subscription operation.'
        },
        FIELD: {
            value: DirectiveLocation.FIELD,
            description: 'Location adjacent to a field.'
        },
        FRAGMENT_DEFINITION: {
            value: DirectiveLocation.FRAGMENT_DEFINITION,
            description: 'Location adjacent to a fragment definition.'
        },
        FRAGMENT_SPREAD: {
            value: DirectiveLocation.FRAGMENT_SPREAD,
            description: 'Location adjacent to a fragment spread.'
        },
        INLINE_FRAGMENT: {
            value: DirectiveLocation.INLINE_FRAGMENT,
            description: 'Location adjacent to an inline fragment.'
        },
        VARIABLE_DEFINITION: {
            value: DirectiveLocation.VARIABLE_DEFINITION,
            description: 'Location adjacent to a variable definition.'
        },
        SCHEMA: {
            value: DirectiveLocation.SCHEMA,
            description: 'Location adjacent to a schema definition.'
        },
        SCALAR: {
            value: DirectiveLocation.SCALAR,
            description: 'Location adjacent to a scalar definition.'
        },
        OBJECT: {
            value: DirectiveLocation.OBJECT,
            description: 'Location adjacent to an object type definition.'
        },
        FIELD_DEFINITION: {
            value: DirectiveLocation.FIELD_DEFINITION,
            description: 'Location adjacent to a field definition.'
        },
        ARGUMENT_DEFINITION: {
            value: DirectiveLocation.ARGUMENT_DEFINITION,
            description: 'Location adjacent to an argument definition.'
        },
        INTERFACE: {
            value: DirectiveLocation.INTERFACE,
            description: 'Location adjacent to an interface definition.'
        },
        UNION: {
            value: DirectiveLocation.UNION,
            description: 'Location adjacent to a union definition.'
        },
        ENUM: {
            value: DirectiveLocation.ENUM,
            description: 'Location adjacent to an enum definition.'
        },
        ENUM_VALUE: {
            value: DirectiveLocation.ENUM_VALUE,
            description: 'Location adjacent to an enum value definition.'
        },
        INPUT_OBJECT: {
            value: DirectiveLocation.INPUT_OBJECT,
            description: 'Location adjacent to an input object type definition.'
        },
        INPUT_FIELD_DEFINITION: {
            value: DirectiveLocation.INPUT_FIELD_DEFINITION,
            description: 'Location adjacent to an input object field definition.'
        }
    }
});
const __Type = new GraphQLObjectType({
    name: '__Type',
    description: 'The fundamental unit of any GraphQL Schema is the type. There are many kinds of types in GraphQL as represented by the `__TypeKind` enum.\n\nDepending on the kind of a type, certain fields describe information about that type. Scalar types provide no information beyond a name and description, while Enum types provide their values. Object and Interface types provide the fields they describe. Abstract types, Union and Interface, provide the Object types possible at runtime. List and NonNull types compose other types.',
    fields: ()=>({
            kind: {
                type: GraphQLNonNull(__TypeKind),
                resolve (type) {
                    if (isScalarType(type)) {
                        return TypeKind.SCALAR;
                    }
                    if (isObjectType(type)) {
                        return TypeKind.OBJECT;
                    }
                    if (isInterfaceType(type)) {
                        return TypeKind.INTERFACE;
                    }
                    if (isUnionType(type)) {
                        return TypeKind.UNION;
                    }
                    if (isEnumType(type)) {
                        return TypeKind.ENUM;
                    }
                    if (isInputObjectType(type)) {
                        return TypeKind.INPUT_OBJECT;
                    }
                    if (isListType(type)) {
                        return TypeKind.LIST;
                    }
                    if (isNonNullType(type)) {
                        return TypeKind.NON_NULL;
                    }
                    invariant(false, `Unexpected type: "${inspect(type)}".`);
                }
            },
            name: {
                type: GraphQLString,
                resolve: (type)=>type.name !== undefined ? type.name : undefined
            },
            description: {
                type: GraphQLString,
                resolve: (type)=>type.description !== undefined ? type.description : undefined
            },
            fields: {
                type: GraphQLList(GraphQLNonNull(__Field)),
                args: {
                    includeDeprecated: {
                        type: GraphQLBoolean,
                        defaultValue: false
                    }
                },
                resolve (type, { includeDeprecated  }) {
                    if (isObjectType(type) || isInterfaceType(type)) {
                        let fields = objectValues(type.getFields());
                        if (!includeDeprecated) {
                            fields = fields.filter((field)=>!field.isDeprecated
                            );
                        }
                        return fields;
                    }
                    return null;
                }
            },
            interfaces: {
                type: GraphQLList(GraphQLNonNull(__Type)),
                resolve (type) {
                    if (isObjectType(type) || isInterfaceType(type)) {
                        return type.getInterfaces();
                    }
                }
            },
            possibleTypes: {
                type: GraphQLList(GraphQLNonNull(__Type)),
                resolve (type, _args, _context, { schema  }) {
                    if (isAbstractType(type)) {
                        return schema.getPossibleTypes(type);
                    }
                }
            },
            enumValues: {
                type: GraphQLList(GraphQLNonNull(__EnumValue)),
                args: {
                    includeDeprecated: {
                        type: GraphQLBoolean,
                        defaultValue: false
                    }
                },
                resolve (type, { includeDeprecated  }) {
                    if (isEnumType(type)) {
                        let values = type.getValues();
                        if (!includeDeprecated) {
                            values = values.filter((value)=>!value.isDeprecated
                            );
                        }
                        return values;
                    }
                }
            },
            inputFields: {
                type: GraphQLList(GraphQLNonNull(__InputValue)),
                resolve (type) {
                    if (isInputObjectType(type)) {
                        return objectValues(type.getFields());
                    }
                }
            },
            ofType: {
                type: __Type,
                resolve: (type)=>type.ofType !== undefined ? type.ofType : undefined
            }
        })
});
const __Field = new GraphQLObjectType({
    name: '__Field',
    description: 'Object and Interface types are described by a list of Fields, each of which has a name, potentially a list of arguments, and a return type.',
    fields: ()=>({
            name: {
                type: GraphQLNonNull(GraphQLString),
                resolve: (field)=>field.name
            },
            description: {
                type: GraphQLString,
                resolve: (field)=>field.description
            },
            args: {
                type: GraphQLNonNull(GraphQLList(GraphQLNonNull(__InputValue))),
                resolve: (field)=>field.args
            },
            type: {
                type: GraphQLNonNull(__Type),
                resolve: (field)=>field.type
            },
            isDeprecated: {
                type: GraphQLNonNull(GraphQLBoolean),
                resolve: (field)=>field.isDeprecated
            },
            deprecationReason: {
                type: GraphQLString,
                resolve: (field)=>field.deprecationReason
            }
        })
});
const __InputValue = new GraphQLObjectType({
    name: '__InputValue',
    description: 'Arguments provided to Fields or Directives and the input fields of an InputObject are represented as Input Values which describe their type and optionally a default value.',
    fields: ()=>({
            name: {
                type: GraphQLNonNull(GraphQLString),
                resolve: (inputValue)=>inputValue.name
            },
            description: {
                type: GraphQLString,
                resolve: (inputValue)=>inputValue.description
            },
            type: {
                type: GraphQLNonNull(__Type),
                resolve: (inputValue)=>inputValue.type
            },
            defaultValue: {
                type: GraphQLString,
                description: 'A GraphQL-formatted string representing the default value for this input value.',
                resolve (inputValue) {
                    const { type , defaultValue  } = inputValue;
                    const valueAST = astFromValue(defaultValue, type);
                    return valueAST ? print(valueAST) : null;
                }
            }
        })
});
const __EnumValue = new GraphQLObjectType({
    name: '__EnumValue',
    description: 'One possible value for a given Enum. Enum values are unique values, not a placeholder for a string or numeric value. However an Enum value is returned in a JSON response as a string.',
    fields: ()=>({
            name: {
                type: GraphQLNonNull(GraphQLString),
                resolve: (enumValue)=>enumValue.name
            },
            description: {
                type: GraphQLString,
                resolve: (enumValue)=>enumValue.description
            },
            isDeprecated: {
                type: GraphQLNonNull(GraphQLBoolean),
                resolve: (enumValue)=>enumValue.isDeprecated
            },
            deprecationReason: {
                type: GraphQLString,
                resolve: (enumValue)=>enumValue.deprecationReason
            }
        })
});
const TypeKind = Object.freeze({
    SCALAR: 'SCALAR',
    OBJECT: 'OBJECT',
    INTERFACE: 'INTERFACE',
    UNION: 'UNION',
    ENUM: 'ENUM',
    INPUT_OBJECT: 'INPUT_OBJECT',
    LIST: 'LIST',
    NON_NULL: 'NON_NULL'
});
const __TypeKind = new GraphQLEnumType({
    name: '__TypeKind',
    description: 'An enum describing what kind of type a given `__Type` is.',
    values: {
        SCALAR: {
            value: TypeKind.SCALAR,
            description: 'Indicates this type is a scalar.'
        },
        OBJECT: {
            value: TypeKind.OBJECT,
            description: 'Indicates this type is an object. `fields` and `interfaces` are valid fields.'
        },
        INTERFACE: {
            value: TypeKind.INTERFACE,
            description: 'Indicates this type is an interface. `fields`, `interfaces`, and `possibleTypes` are valid fields.'
        },
        UNION: {
            value: TypeKind.UNION,
            description: 'Indicates this type is a union. `possibleTypes` is a valid field.'
        },
        ENUM: {
            value: TypeKind.ENUM,
            description: 'Indicates this type is an enum. `enumValues` is a valid field.'
        },
        INPUT_OBJECT: {
            value: TypeKind.INPUT_OBJECT,
            description: 'Indicates this type is an input object. `inputFields` is a valid field.'
        },
        LIST: {
            value: TypeKind.LIST,
            description: 'Indicates this type is a list. `ofType` is a valid field.'
        },
        NON_NULL: {
            value: TypeKind.NON_NULL,
            description: 'Indicates this type is a non-null. `ofType` is a valid field.'
        }
    }
});
const SchemaMetaFieldDef = {
    name: '__schema',
    type: GraphQLNonNull(__Schema),
    description: 'Access the current type schema of this server.',
    args: [],
    resolve: (_source, _args, _context, { schema  })=>schema
    ,
    isDeprecated: false,
    deprecationReason: undefined,
    extensions: undefined,
    astNode: undefined
};
const TypeMetaFieldDef = {
    name: '__type',
    type: __Type,
    description: 'Request the type information of a single type.',
    args: [
        {
            name: 'name',
            description: undefined,
            type: GraphQLNonNull(GraphQLString),
            defaultValue: undefined,
            extensions: undefined,
            astNode: undefined
        }
    ],
    resolve: (_source, { name  }, _context, { schema  })=>schema.getType(name)
    ,
    isDeprecated: false,
    deprecationReason: undefined,
    extensions: undefined,
    astNode: undefined
};
const TypeNameMetaFieldDef = {
    name: '__typename',
    type: GraphQLNonNull(GraphQLString),
    description: 'The name of the current Object type at runtime.',
    args: [],
    resolve: (_source, _args, _context, { parentType  })=>parentType.name
    ,
    isDeprecated: false,
    deprecationReason: undefined,
    extensions: undefined,
    astNode: undefined
};
const introspectionTypes = Object.freeze([
    __Schema,
    __Directive,
    __DirectiveLocation,
    __Type,
    __Field,
    __InputValue,
    __EnumValue,
    __TypeKind
]);
function isIntrospectionType(type) {
    return introspectionTypes.some(({ name  })=>type.name === name
    );
}
function isSchema(schema) {
    return __default(schema, GraphQLSchema);
}
function assertSchema(schema) {
    if (!isSchema(schema)) {
        throw new Error(`Expected ${inspect(schema)} to be a GraphQL schema.`);
    }
    return schema;
}
class GraphQLSchema {
    constructor(config){
        this.__validationErrors = config.assumeValid === true ? [] : undefined;
        devAssert(isObjectLike(config), 'Must provide configuration object.');
        devAssert(!config.types || Array.isArray(config.types), `"types" must be Array if provided but got: ${inspect(config.types)}.`);
        devAssert(!config.directives || Array.isArray(config.directives), '"directives" must be Array if provided but got: ' + `${inspect(config.directives)}.`);
        this.description = config.description;
        this.extensions = config.extensions && toObjMap(config.extensions);
        this.astNode = config.astNode;
        this.extensionASTNodes = config.extensionASTNodes;
        this._queryType = config.query;
        this._mutationType = config.mutation;
        this._subscriptionType = config.subscription;
        this._directives = config.directives ?? specifiedDirectives;
        const allReferencedTypes = new Set(config.types);
        if (config.types != null) {
            for (const type of config.types){
                allReferencedTypes.delete(type);
                collectReferencedTypes(type, allReferencedTypes);
            }
        }
        if (this._queryType != null) {
            collectReferencedTypes(this._queryType, allReferencedTypes);
        }
        if (this._mutationType != null) {
            collectReferencedTypes(this._mutationType, allReferencedTypes);
        }
        if (this._subscriptionType != null) {
            collectReferencedTypes(this._subscriptionType, allReferencedTypes);
        }
        for (const directive of this._directives){
            if (isDirective(directive)) {
                for (const arg of directive.args){
                    collectReferencedTypes(arg.type, allReferencedTypes);
                }
            }
        }
        collectReferencedTypes(__Schema, allReferencedTypes);
        this._typeMap = Object.create(null);
        this._subTypeMap = Object.create(null);
        this._implementationsMap = Object.create(null);
        for (const namedType of arrayFrom(allReferencedTypes)){
            if (namedType == null) {
                continue;
            }
            const typeName = namedType.name;
            devAssert(typeName, 'One of the provided types for building the Schema is missing a name.');
            if (this._typeMap[typeName] !== undefined) {
                throw new Error(`Schema must contain uniquely named types but contains multiple types named "${typeName}".`);
            }
            this._typeMap[typeName] = namedType;
            if (isInterfaceType(namedType)) {
                for (const iface of namedType.getInterfaces()){
                    if (isInterfaceType(iface)) {
                        let implementations = this._implementationsMap[iface.name];
                        if (implementations === undefined) {
                            implementations = this._implementationsMap[iface.name] = {
                                objects: [],
                                interfaces: []
                            };
                        }
                        implementations.interfaces.push(namedType);
                    }
                }
            } else if (isObjectType(namedType)) {
                for (const iface of namedType.getInterfaces()){
                    if (isInterfaceType(iface)) {
                        let implementations = this._implementationsMap[iface.name];
                        if (implementations === undefined) {
                            implementations = this._implementationsMap[iface.name] = {
                                objects: [],
                                interfaces: []
                            };
                        }
                        implementations.objects.push(namedType);
                    }
                }
            }
        }
    }
    getQueryType() {
        return this._queryType;
    }
    getMutationType() {
        return this._mutationType;
    }
    getSubscriptionType() {
        return this._subscriptionType;
    }
    getTypeMap() {
        return this._typeMap;
    }
    getType(name) {
        return this.getTypeMap()[name];
    }
    getPossibleTypes(abstractType) {
        return isUnionType(abstractType) ? abstractType.getTypes() : this.getImplementations(abstractType).objects;
    }
    getImplementations(interfaceType) {
        const implementations = this._implementationsMap[interfaceType.name];
        return implementations ?? {
            objects: [],
            interfaces: []
        };
    }
    isPossibleType(abstractType, possibleType) {
        return this.isSubType(abstractType, possibleType);
    }
    isSubType(abstractType, maybeSubType) {
        let map = this._subTypeMap[abstractType.name];
        if (map === undefined) {
            map = Object.create(null);
            if (isUnionType(abstractType)) {
                for (const type of abstractType.getTypes()){
                    map[type.name] = true;
                }
            } else {
                const implementations = this.getImplementations(abstractType);
                for (const type of implementations.objects){
                    map[type.name] = true;
                }
                for (const type1 of implementations.interfaces){
                    map[type1.name] = true;
                }
            }
            this._subTypeMap[abstractType.name] = map;
        }
        return map[maybeSubType.name] !== undefined;
    }
    getDirectives() {
        return this._directives;
    }
    getDirective(name) {
        return find(this.getDirectives(), (directive)=>directive.name === name
        );
    }
    toConfig() {
        return {
            description: this.description,
            query: this.getQueryType(),
            mutation: this.getMutationType(),
            subscription: this.getSubscriptionType(),
            types: objectValues(this.getTypeMap()),
            directives: this.getDirectives().slice(),
            extensions: this.extensions,
            astNode: this.astNode,
            extensionASTNodes: this.extensionASTNodes ?? [],
            assumeValid: this.__validationErrors !== undefined
        };
    }
    get [SYMBOL_TO_STRING_TAG]() {
        return 'GraphQLSchema';
    }
}
function collectReferencedTypes(type, typeSet) {
    const namedType = getNamedType(type);
    if (!typeSet.has(namedType)) {
        typeSet.add(namedType);
        if (isUnionType(namedType)) {
            for (const memberType of namedType.getTypes()){
                collectReferencedTypes(memberType, typeSet);
            }
        } else if (isObjectType(namedType) || isInterfaceType(namedType)) {
            for (const interfaceType of namedType.getInterfaces()){
                collectReferencedTypes(interfaceType, typeSet);
            }
            for (const field of objectValues(namedType.getFields())){
                collectReferencedTypes(field.type, typeSet);
                for (const arg of field.args){
                    collectReferencedTypes(arg.type, typeSet);
                }
            }
        } else if (isInputObjectType(namedType)) {
            for (const field of objectValues(namedType.getFields())){
                collectReferencedTypes(field.type, typeSet);
            }
        }
    }
    return typeSet;
}
function validateSchema(schema) {
    assertSchema(schema);
    if (schema.__validationErrors) {
        return schema.__validationErrors;
    }
    const context = new SchemaValidationContext(schema);
    validateRootTypes(context);
    validateDirectives(context);
    validateTypes(context);
    const errors = context.getErrors();
    schema.__validationErrors = errors;
    return errors;
}
function assertValidSchema(schema) {
    const errors = validateSchema(schema);
    if (errors.length !== 0) {
        throw new Error(errors.map((error)=>error.message
        ).join('\n\n'));
    }
}
class SchemaValidationContext {
    constructor(schema){
        this._errors = [];
        this.schema = schema;
    }
    reportError(message, nodes) {
        const _nodes = Array.isArray(nodes) ? nodes.filter(Boolean) : nodes;
        this.addError(new GraphQLError(message, _nodes));
    }
    addError(error) {
        this._errors.push(error);
    }
    getErrors() {
        return this._errors;
    }
}
function validateRootTypes(context) {
    const schema = context.schema;
    const queryType = schema.getQueryType();
    if (!queryType) {
        context.reportError('Query root type must be provided.', schema.astNode);
    } else if (!isObjectType(queryType)) {
        context.reportError(`Query root type must be Object type, it cannot be ${inspect(queryType)}.`, getOperationTypeNode(schema, queryType, 'query'));
    }
    const mutationType = schema.getMutationType();
    if (mutationType && !isObjectType(mutationType)) {
        context.reportError('Mutation root type must be Object type if provided, it cannot be ' + `${inspect(mutationType)}.`, getOperationTypeNode(schema, mutationType, 'mutation'));
    }
    const subscriptionType = schema.getSubscriptionType();
    if (subscriptionType && !isObjectType(subscriptionType)) {
        context.reportError('Subscription root type must be Object type if provided, it cannot be ' + `${inspect(subscriptionType)}.`, getOperationTypeNode(schema, subscriptionType, 'subscription'));
    }
}
function getOperationTypeNode(schema, type, operation) {
    const operationNodes = getAllSubNodes(schema, (node)=>node.operationTypes
    );
    for (const node1 of operationNodes){
        if (node1.operation === operation) {
            return node1.type;
        }
    }
    return type.astNode;
}
function validateDirectives(context) {
    for (const directive of context.schema.getDirectives()){
        if (!isDirective(directive)) {
            context.reportError(`Expected directive but got: ${inspect(directive)}.`, directive?.astNode);
            continue;
        }
        validateName(context, directive);
        for (const arg of directive.args){
            validateName(context, arg);
            if (!isInputType(arg.type)) {
                context.reportError(`The type of @${directive.name}(${arg.name}:) must be Input Type ` + `but got: ${inspect(arg.type)}.`, arg.astNode);
            }
        }
    }
}
function validateName(context, node) {
    const error = isValidNameError(node.name);
    if (error) {
        context.addError(locatedError(error, node.astNode));
    }
}
function validateTypes(context) {
    const validateInputObjectCircularRefs = createInputObjectCircularRefsValidator(context);
    const typeMap = context.schema.getTypeMap();
    for (const type of objectValues(typeMap)){
        if (!isNamedType(type)) {
            context.reportError(`Expected GraphQL named type but got: ${inspect(type)}.`, type.astNode);
            continue;
        }
        if (!isIntrospectionType(type)) {
            validateName(context, type);
        }
        if (isObjectType(type)) {
            validateFields(context, type);
            validateInterfaces(context, type);
        } else if (isInterfaceType(type)) {
            validateFields(context, type);
            validateInterfaces(context, type);
        } else if (isUnionType(type)) {
            validateUnionMembers(context, type);
        } else if (isEnumType(type)) {
            validateEnumValues(context, type);
        } else if (isInputObjectType(type)) {
            validateInputFields(context, type);
            validateInputObjectCircularRefs(type);
        }
    }
}
function validateFields(context, type) {
    const fields = objectValues(type.getFields());
    if (fields.length === 0) {
        context.reportError(`Type ${type.name} must define one or more fields.`, getAllNodes(type));
    }
    for (const field of fields){
        validateName(context, field);
        if (!isOutputType(field.type)) {
            context.reportError(`The type of ${type.name}.${field.name} must be Output Type ` + `but got: ${inspect(field.type)}.`, field.astNode?.type);
        }
        for (const arg of field.args){
            const argName = arg.name;
            validateName(context, arg);
            if (!isInputType(arg.type)) {
                context.reportError(`The type of ${type.name}.${field.name}(${argName}:) must be Input ` + `Type but got: ${inspect(arg.type)}.`, arg.astNode?.type);
            }
        }
    }
}
function validateInterfaces(context, type) {
    const ifaceTypeNames = Object.create(null);
    for (const iface of type.getInterfaces()){
        if (!isInterfaceType(iface)) {
            context.reportError(`Type ${inspect(type)} must only implement Interface types, ` + `it cannot implement ${inspect(iface)}.`, getAllImplementsInterfaceNodes(type, iface));
            continue;
        }
        if (type === iface) {
            context.reportError(`Type ${type.name} cannot implement itself because it would create a circular reference.`, getAllImplementsInterfaceNodes(type, iface));
            continue;
        }
        if (ifaceTypeNames[iface.name]) {
            context.reportError(`Type ${type.name} can only implement ${iface.name} once.`, getAllImplementsInterfaceNodes(type, iface));
            continue;
        }
        ifaceTypeNames[iface.name] = true;
        validateTypeImplementsAncestors(context, type, iface);
        validateTypeImplementsInterface(context, type, iface);
    }
}
function validateTypeImplementsInterface(context, type, iface) {
    const typeFieldMap = type.getFields();
    for (const ifaceField of objectValues(iface.getFields())){
        const fieldName = ifaceField.name;
        const typeField = typeFieldMap[fieldName];
        if (!typeField) {
            context.reportError(`Interface field ${iface.name}.${fieldName} expected but ${type.name} does not provide it.`, [
                ifaceField.astNode,
                ...getAllNodes(type)
            ]);
            continue;
        }
        if (!isTypeSubTypeOf(context.schema, typeField.type, ifaceField.type)) {
            context.reportError(`Interface field ${iface.name}.${fieldName} expects type ` + `${inspect(ifaceField.type)} but ${type.name}.${fieldName} ` + `is type ${inspect(typeField.type)}.`, [
                ifaceField.astNode.type,
                typeField.astNode.type
            ]);
        }
        for (const ifaceArg of ifaceField.args){
            const argName = ifaceArg.name;
            const typeArg = find(typeField.args, (arg)=>arg.name === argName
            );
            if (!typeArg) {
                context.reportError(`Interface field argument ${iface.name}.${fieldName}(${argName}:) expected but ${type.name}.${fieldName} does not provide it.`, [
                    ifaceArg.astNode,
                    typeField.astNode
                ]);
                continue;
            }
            if (!isEqualType(ifaceArg.type, typeArg.type)) {
                context.reportError(`Interface field argument ${iface.name}.${fieldName}(${argName}:) ` + `expects type ${inspect(ifaceArg.type)} but ` + `${type.name}.${fieldName}(${argName}:) is type ` + `${inspect(typeArg.type)}.`, [
                    ifaceArg.astNode.type,
                    typeArg.astNode.type
                ]);
            }
        }
        for (const typeArg of typeField.args){
            const argName = typeArg.name;
            const ifaceArg = find(ifaceField.args, (arg)=>arg.name === argName
            );
            if (!ifaceArg && isRequiredArgument(typeArg)) {
                context.reportError(`Object field ${type.name}.${fieldName} includes required argument ${argName} that is missing from the Interface field ${iface.name}.${fieldName}.`, [
                    typeArg.astNode,
                    ifaceField.astNode
                ]);
            }
        }
    }
}
function validateTypeImplementsAncestors(context, type, iface) {
    const ifaceInterfaces = type.getInterfaces();
    for (const transitive of iface.getInterfaces()){
        if (ifaceInterfaces.indexOf(transitive) === -1) {
            context.reportError(transitive === type ? `Type ${type.name} cannot implement ${iface.name} because it would create a circular reference.` : `Type ${type.name} must implement ${transitive.name} because it is implemented by ${iface.name}.`, [
                ...getAllImplementsInterfaceNodes(iface, transitive),
                ...getAllImplementsInterfaceNodes(type, iface)
            ]);
        }
    }
}
function validateUnionMembers(context, union) {
    const memberTypes = union.getTypes();
    if (memberTypes.length === 0) {
        context.reportError(`Union type ${union.name} must define one or more member types.`, getAllNodes(union));
    }
    const includedTypeNames = Object.create(null);
    for (const memberType of memberTypes){
        if (includedTypeNames[memberType.name]) {
            context.reportError(`Union type ${union.name} can only include type ${memberType.name} once.`, getUnionMemberTypeNodes(union, memberType.name));
            continue;
        }
        includedTypeNames[memberType.name] = true;
        if (!isObjectType(memberType)) {
            context.reportError(`Union type ${union.name} can only include Object types, ` + `it cannot include ${inspect(memberType)}.`, getUnionMemberTypeNodes(union, String(memberType)));
        }
    }
}
function validateEnumValues(context, enumType) {
    const enumValues = enumType.getValues();
    if (enumValues.length === 0) {
        context.reportError(`Enum type ${enumType.name} must define one or more values.`, getAllNodes(enumType));
    }
    for (const enumValue of enumValues){
        const valueName = enumValue.name;
        validateName(context, enumValue);
        if (valueName === 'true' || valueName === 'false' || valueName === 'null') {
            context.reportError(`Enum type ${enumType.name} cannot include value: ${valueName}.`, enumValue.astNode);
        }
    }
}
function validateInputFields(context, inputObj) {
    const fields = objectValues(inputObj.getFields());
    if (fields.length === 0) {
        context.reportError(`Input Object type ${inputObj.name} must define one or more fields.`, getAllNodes(inputObj));
    }
    for (const field of fields){
        validateName(context, field);
        if (!isInputType(field.type)) {
            context.reportError(`The type of ${inputObj.name}.${field.name} must be Input Type ` + `but got: ${inspect(field.type)}.`, field.astNode?.type);
        }
    }
}
function createInputObjectCircularRefsValidator(context) {
    const visitedTypes = Object.create(null);
    const fieldPath = [];
    const fieldPathIndexByTypeName = Object.create(null);
    return detectCycleRecursive;
    function detectCycleRecursive(inputObj) {
        if (visitedTypes[inputObj.name]) {
            return;
        }
        visitedTypes[inputObj.name] = true;
        fieldPathIndexByTypeName[inputObj.name] = fieldPath.length;
        const fields = objectValues(inputObj.getFields());
        for (const field of fields){
            if (isNonNullType(field.type) && isInputObjectType(field.type.ofType)) {
                const fieldType = field.type.ofType;
                const cycleIndex = fieldPathIndexByTypeName[fieldType.name];
                fieldPath.push(field);
                if (cycleIndex === undefined) {
                    detectCycleRecursive(fieldType);
                } else {
                    const cyclePath = fieldPath.slice(cycleIndex);
                    const pathStr = cyclePath.map((fieldObj)=>fieldObj.name
                    ).join('.');
                    context.reportError(`Cannot reference Input Object "${fieldType.name}" within itself through a series of non-null fields: "${pathStr}".`, cyclePath.map((fieldObj)=>fieldObj.astNode
                    ));
                }
                fieldPath.pop();
            }
        }
        fieldPathIndexByTypeName[inputObj.name] = undefined;
    }
}
function getAllNodes(object) {
    const { astNode , extensionASTNodes  } = object;
    return astNode ? extensionASTNodes ? [
        astNode
    ].concat(extensionASTNodes) : [
        astNode
    ] : extensionASTNodes ?? [];
}
function getAllSubNodes(object, getter) {
    return flatMap(getAllNodes(object), (item)=>getter(item) ?? []
    );
}
function getAllImplementsInterfaceNodes(type, iface) {
    return getAllSubNodes(type, (typeNode)=>typeNode.interfaces
    ).filter((ifaceNode)=>ifaceNode.name.value === iface.name
    );
}
function getUnionMemberTypeNodes(union, typeName) {
    return getAllSubNodes(union, (unionNode)=>unionNode.types
    ).filter((typeNode)=>typeNode.name.value === typeName
    );
}
function typeFromAST(schema, typeNode) {
    let innerType;
    if (typeNode.kind === Kind.LIST_TYPE) {
        innerType = typeFromAST(schema, typeNode.type);
        return innerType && GraphQLList(innerType);
    }
    if (typeNode.kind === Kind.NON_NULL_TYPE) {
        innerType = typeFromAST(schema, typeNode.type);
        return innerType && GraphQLNonNull(innerType);
    }
    if (typeNode.kind === Kind.NAMED_TYPE) {
        return schema.getType(typeNode.name.value);
    }
    invariant(false, 'Unexpected type node: ' + inspect(typeNode));
}
class TypeInfo {
    constructor(schema, getFieldDefFn, initialType){
        this._schema = schema;
        this._typeStack = [];
        this._parentTypeStack = [];
        this._inputTypeStack = [];
        this._fieldDefStack = [];
        this._defaultValueStack = [];
        this._directive = null;
        this._argument = null;
        this._enumValue = null;
        this._getFieldDef = getFieldDefFn ?? getFieldDef;
        if (initialType) {
            if (isInputType(initialType)) {
                this._inputTypeStack.push(initialType);
            }
            if (isCompositeType(initialType)) {
                this._parentTypeStack.push(initialType);
            }
            if (isOutputType(initialType)) {
                this._typeStack.push(initialType);
            }
        }
    }
    getType() {
        if (this._typeStack.length > 0) {
            return this._typeStack[this._typeStack.length - 1];
        }
    }
    getParentType() {
        if (this._parentTypeStack.length > 0) {
            return this._parentTypeStack[this._parentTypeStack.length - 1];
        }
    }
    getInputType() {
        if (this._inputTypeStack.length > 0) {
            return this._inputTypeStack[this._inputTypeStack.length - 1];
        }
    }
    getParentInputType() {
        if (this._inputTypeStack.length > 1) {
            return this._inputTypeStack[this._inputTypeStack.length - 2];
        }
    }
    getFieldDef() {
        if (this._fieldDefStack.length > 0) {
            return this._fieldDefStack[this._fieldDefStack.length - 1];
        }
    }
    getDefaultValue() {
        if (this._defaultValueStack.length > 0) {
            return this._defaultValueStack[this._defaultValueStack.length - 1];
        }
    }
    getDirective() {
        return this._directive;
    }
    getArgument() {
        return this._argument;
    }
    getEnumValue() {
        return this._enumValue;
    }
    enter(node) {
        const schema = this._schema;
        switch(node.kind){
            case Kind.SELECTION_SET:
                {
                    const namedType = getNamedType(this.getType());
                    this._parentTypeStack.push(isCompositeType(namedType) ? namedType : undefined);
                    break;
                }
            case Kind.FIELD:
                {
                    const parentType = this.getParentType();
                    let fieldDef;
                    let fieldType;
                    if (parentType) {
                        fieldDef = this._getFieldDef(schema, parentType, node);
                        if (fieldDef) {
                            fieldType = fieldDef.type;
                        }
                    }
                    this._fieldDefStack.push(fieldDef);
                    this._typeStack.push(isOutputType(fieldType) ? fieldType : undefined);
                    break;
                }
            case Kind.DIRECTIVE:
                this._directive = schema.getDirective(node.name.value);
                break;
            case Kind.OPERATION_DEFINITION:
                {
                    let type;
                    switch(node.operation){
                        case 'query':
                            type = schema.getQueryType();
                            break;
                        case 'mutation':
                            type = schema.getMutationType();
                            break;
                        case 'subscription':
                            type = schema.getSubscriptionType();
                            break;
                    }
                    this._typeStack.push(isObjectType(type) ? type : undefined);
                    break;
                }
            case Kind.INLINE_FRAGMENT:
            case Kind.FRAGMENT_DEFINITION:
                {
                    const typeConditionAST = node.typeCondition;
                    const outputType = typeConditionAST ? typeFromAST(schema, typeConditionAST) : getNamedType(this.getType());
                    this._typeStack.push(isOutputType(outputType) ? outputType : undefined);
                    break;
                }
            case Kind.VARIABLE_DEFINITION:
                {
                    const inputType = typeFromAST(schema, node.type);
                    this._inputTypeStack.push(isInputType(inputType) ? inputType : undefined);
                    break;
                }
            case Kind.ARGUMENT:
                {
                    let argDef;
                    let argType;
                    const fieldOrDirective = this.getDirective() ?? this.getFieldDef();
                    if (fieldOrDirective) {
                        argDef = find(fieldOrDirective.args, (arg)=>arg.name === node.name.value
                        );
                        if (argDef) {
                            argType = argDef.type;
                        }
                    }
                    this._argument = argDef;
                    this._defaultValueStack.push(argDef ? argDef.defaultValue : undefined);
                    this._inputTypeStack.push(isInputType(argType) ? argType : undefined);
                    break;
                }
            case Kind.LIST:
                {
                    const listType = getNullableType(this.getInputType());
                    const itemType = isListType(listType) ? listType.ofType : listType;
                    this._defaultValueStack.push(undefined);
                    this._inputTypeStack.push(isInputType(itemType) ? itemType : undefined);
                    break;
                }
            case Kind.OBJECT_FIELD:
                {
                    const objectType = getNamedType(this.getInputType());
                    let inputFieldType;
                    let inputField;
                    if (isInputObjectType(objectType)) {
                        inputField = objectType.getFields()[node.name.value];
                        if (inputField) {
                            inputFieldType = inputField.type;
                        }
                    }
                    this._defaultValueStack.push(inputField ? inputField.defaultValue : undefined);
                    this._inputTypeStack.push(isInputType(inputFieldType) ? inputFieldType : undefined);
                    break;
                }
            case Kind.ENUM:
                {
                    const enumType = getNamedType(this.getInputType());
                    let enumValue;
                    if (isEnumType(enumType)) {
                        enumValue = enumType.getValue(node.value);
                    }
                    this._enumValue = enumValue;
                    break;
                }
        }
    }
    leave(node) {
        switch(node.kind){
            case Kind.SELECTION_SET:
                this._parentTypeStack.pop();
                break;
            case Kind.FIELD:
                this._fieldDefStack.pop();
                this._typeStack.pop();
                break;
            case Kind.DIRECTIVE:
                this._directive = null;
                break;
            case Kind.OPERATION_DEFINITION:
            case Kind.INLINE_FRAGMENT:
            case Kind.FRAGMENT_DEFINITION:
                this._typeStack.pop();
                break;
            case Kind.VARIABLE_DEFINITION:
                this._inputTypeStack.pop();
                break;
            case Kind.ARGUMENT:
                this._argument = null;
                this._defaultValueStack.pop();
                this._inputTypeStack.pop();
                break;
            case Kind.LIST:
            case Kind.OBJECT_FIELD:
                this._defaultValueStack.pop();
                this._inputTypeStack.pop();
                break;
            case Kind.ENUM:
                this._enumValue = null;
                break;
        }
    }
}
function getFieldDef(schema, parentType, fieldNode) {
    const name = fieldNode.name.value;
    if (name === SchemaMetaFieldDef.name && schema.getQueryType() === parentType) {
        return SchemaMetaFieldDef;
    }
    if (name === TypeMetaFieldDef.name && schema.getQueryType() === parentType) {
        return TypeMetaFieldDef;
    }
    if (name === TypeNameMetaFieldDef.name && isCompositeType(parentType)) {
        return TypeNameMetaFieldDef;
    }
    if (isObjectType(parentType) || isInterfaceType(parentType)) {
        return parentType.getFields()[name];
    }
}
function visitWithTypeInfo(typeInfo, visitor) {
    return {
        enter (node) {
            typeInfo.enter(node);
            const fn = getVisitFn(visitor, node.kind, false);
            if (fn) {
                const result = fn.apply(visitor, arguments);
                if (result !== undefined) {
                    typeInfo.leave(node);
                    if (isNode(result)) {
                        typeInfo.enter(result);
                    }
                }
                return result;
            }
        },
        leave (node) {
            const fn = getVisitFn(visitor, node.kind, true);
            let result;
            if (fn) {
                result = fn.apply(visitor, arguments);
            }
            typeInfo.leave(node);
            return result;
        }
    };
}
function isExecutableDefinitionNode(node) {
    return node.kind === Kind.OPERATION_DEFINITION || node.kind === Kind.FRAGMENT_DEFINITION;
}
function isTypeSystemDefinitionNode(node) {
    return node.kind === Kind.SCHEMA_DEFINITION || isTypeDefinitionNode(node) || node.kind === Kind.DIRECTIVE_DEFINITION;
}
function isTypeDefinitionNode(node) {
    return node.kind === Kind.SCALAR_TYPE_DEFINITION || node.kind === Kind.OBJECT_TYPE_DEFINITION || node.kind === Kind.INTERFACE_TYPE_DEFINITION || node.kind === Kind.UNION_TYPE_DEFINITION || node.kind === Kind.ENUM_TYPE_DEFINITION || node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION;
}
function isTypeSystemExtensionNode(node) {
    return node.kind === Kind.SCHEMA_EXTENSION || isTypeExtensionNode(node);
}
function isTypeExtensionNode(node) {
    return node.kind === Kind.SCALAR_TYPE_EXTENSION || node.kind === Kind.OBJECT_TYPE_EXTENSION || node.kind === Kind.INTERFACE_TYPE_EXTENSION || node.kind === Kind.UNION_TYPE_EXTENSION || node.kind === Kind.ENUM_TYPE_EXTENSION || node.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION;
}
function ExecutableDefinitionsRule(context) {
    return {
        Document (node) {
            for (const definition of node.definitions){
                if (!isExecutableDefinitionNode(definition)) {
                    const defName = definition.kind === Kind.SCHEMA_DEFINITION || definition.kind === Kind.SCHEMA_EXTENSION ? 'schema' : '"' + definition.name.value + '"';
                    context.reportError(new GraphQLError(`The ${defName} definition is not executable.`, definition));
                }
            }
            return false;
        }
    };
}
function UniqueOperationNamesRule(context) {
    const knownOperationNames = Object.create(null);
    return {
        OperationDefinition (node) {
            const operationName = node.name;
            if (operationName) {
                if (knownOperationNames[operationName.value]) {
                    context.reportError(new GraphQLError(`There can be only one operation named "${operationName.value}".`, [
                        knownOperationNames[operationName.value],
                        operationName
                    ]));
                } else {
                    knownOperationNames[operationName.value] = operationName;
                }
            }
            return false;
        },
        FragmentDefinition: ()=>false
    };
}
function LoneAnonymousOperationRule(context) {
    let operationCount = 0;
    return {
        Document (node) {
            operationCount = node.definitions.filter((definition)=>definition.kind === Kind.OPERATION_DEFINITION
            ).length;
        },
        OperationDefinition (node) {
            if (!node.name && operationCount > 1) {
                context.reportError(new GraphQLError('This anonymous operation must be the only defined operation.', node));
            }
        }
    };
}
function SingleFieldSubscriptionsRule(context) {
    return {
        OperationDefinition (node) {
            if (node.operation === 'subscription') {
                if (node.selectionSet.selections.length !== 1) {
                    context.reportError(new GraphQLError(node.name ? `Subscription "${node.name.value}" must select only one top level field.` : 'Anonymous Subscription must select only one top level field.', node.selectionSet.selections.slice(1)));
                }
            }
        }
    };
}
function KnownTypeNamesRule(context) {
    const schema = context.getSchema();
    const existingTypesMap = schema ? schema.getTypeMap() : Object.create(null);
    const definedTypes = Object.create(null);
    for (const def of context.getDocument().definitions){
        if (isTypeDefinitionNode(def)) {
            definedTypes[def.name.value] = true;
        }
    }
    const typeNames = Object.keys(existingTypesMap).concat(Object.keys(definedTypes));
    return {
        NamedType (node, _1, parent, _2, ancestors) {
            const typeName = node.name.value;
            if (!existingTypesMap[typeName] && !definedTypes[typeName]) {
                const definitionNode = ancestors[2] ?? parent;
                const isSDL = definitionNode != null && isSDLNode(definitionNode);
                if (isSDL && isSpecifiedScalarName(typeName)) {
                    return;
                }
                const suggestedTypes = suggestionList(typeName, isSDL ? specifiedScalarsNames.concat(typeNames) : typeNames);
                context.reportError(new GraphQLError(`Unknown type "${typeName}".` + didYouMean(suggestedTypes), node));
            }
        }
    };
}
const specifiedScalarsNames = specifiedScalarTypes.map((type)=>type.name
);
function isSpecifiedScalarName(typeName) {
    return specifiedScalarsNames.indexOf(typeName) !== -1;
}
function isSDLNode(value) {
    return !Array.isArray(value) && (isTypeSystemDefinitionNode(value) || isTypeSystemExtensionNode(value));
}
function FragmentsOnCompositeTypesRule(context) {
    return {
        InlineFragment (node) {
            const typeCondition = node.typeCondition;
            if (typeCondition) {
                const type = typeFromAST(context.getSchema(), typeCondition);
                if (type && !isCompositeType(type)) {
                    const typeStr = print(typeCondition);
                    context.reportError(new GraphQLError(`Fragment cannot condition on non composite type "${typeStr}".`, typeCondition));
                }
            }
        },
        FragmentDefinition (node) {
            const type = typeFromAST(context.getSchema(), node.typeCondition);
            if (type && !isCompositeType(type)) {
                const typeStr = print(node.typeCondition);
                context.reportError(new GraphQLError(`Fragment "${node.name.value}" cannot condition on non composite type "${typeStr}".`, node.typeCondition));
            }
        }
    };
}
function VariablesAreInputTypesRule(context) {
    return {
        VariableDefinition (node) {
            const type = typeFromAST(context.getSchema(), node.type);
            if (type && !isInputType(type)) {
                const variableName = node.variable.name.value;
                const typeName = print(node.type);
                context.reportError(new GraphQLError(`Variable "$${variableName}" cannot be non-input type "${typeName}".`, node.type));
            }
        }
    };
}
function ScalarLeafsRule(context) {
    return {
        Field (node) {
            const type = context.getType();
            const selectionSet = node.selectionSet;
            if (type) {
                if (isLeafType(getNamedType(type))) {
                    if (selectionSet) {
                        const fieldName = node.name.value;
                        const typeStr = inspect(type);
                        context.reportError(new GraphQLError(`Field "${fieldName}" must not have a selection since type "${typeStr}" has no subfields.`, selectionSet));
                    }
                } else if (!selectionSet) {
                    const fieldName = node.name.value;
                    const typeStr = inspect(type);
                    context.reportError(new GraphQLError(`Field "${fieldName}" of type "${typeStr}" must have a selection of subfields. Did you mean "${fieldName} { ... }"?`, node));
                }
            }
        }
    };
}
function FieldsOnCorrectTypeRule(context) {
    return {
        Field (node) {
            const type = context.getParentType();
            if (type) {
                const fieldDef = context.getFieldDef();
                if (!fieldDef) {
                    const schema = context.getSchema();
                    const fieldName = node.name.value;
                    let suggestion = didYouMean('to use an inline fragment on', getSuggestedTypeNames(schema, type, fieldName));
                    if (suggestion === '') {
                        suggestion = didYouMean(getSuggestedFieldNames(type, fieldName));
                    }
                    context.reportError(new GraphQLError(`Cannot query field "${fieldName}" on type "${type.name}".` + suggestion, node));
                }
            }
        }
    };
}
function getSuggestedTypeNames(schema, type, fieldName) {
    if (!isAbstractType(type)) {
        return [];
    }
    const suggestedTypes = new Set();
    const usageCount = Object.create(null);
    for (const possibleType of schema.getPossibleTypes(type)){
        if (!possibleType.getFields()[fieldName]) {
            continue;
        }
        suggestedTypes.add(possibleType);
        usageCount[possibleType.name] = 1;
        for (const possibleInterface of possibleType.getInterfaces()){
            if (!possibleInterface.getFields()[fieldName]) {
                continue;
            }
            suggestedTypes.add(possibleInterface);
            usageCount[possibleInterface.name] = (usageCount[possibleInterface.name] ?? 0) + 1;
        }
    }
    return arrayFrom(suggestedTypes).sort((typeA, typeB)=>{
        const usageCountDiff = usageCount[typeB.name] - usageCount[typeA.name];
        if (usageCountDiff !== 0) {
            return usageCountDiff;
        }
        if (isInterfaceType(typeA) && schema.isSubType(typeA, typeB)) {
            return -1;
        }
        if (isInterfaceType(typeB) && schema.isSubType(typeB, typeA)) {
            return 1;
        }
        return typeA.name.localeCompare(typeB.name);
    }).map((x)=>x.name
    );
}
function getSuggestedFieldNames(type, fieldName) {
    if (isObjectType(type) || isInterfaceType(type)) {
        const possibleFieldNames = Object.keys(type.getFields());
        return suggestionList(fieldName, possibleFieldNames);
    }
    return [];
}
function UniqueFragmentNamesRule(context) {
    const knownFragmentNames = Object.create(null);
    return {
        OperationDefinition: ()=>false
        ,
        FragmentDefinition (node) {
            const fragmentName = node.name.value;
            if (knownFragmentNames[fragmentName]) {
                context.reportError(new GraphQLError(`There can be only one fragment named "${fragmentName}".`, [
                    knownFragmentNames[fragmentName],
                    node.name
                ]));
            } else {
                knownFragmentNames[fragmentName] = node.name;
            }
            return false;
        }
    };
}
function KnownFragmentNamesRule(context) {
    return {
        FragmentSpread (node) {
            const fragmentName = node.name.value;
            const fragment = context.getFragment(fragmentName);
            if (!fragment) {
                context.reportError(new GraphQLError(`Unknown fragment "${fragmentName}".`, node.name));
            }
        }
    };
}
function NoUnusedFragmentsRule(context) {
    const operationDefs = [];
    const fragmentDefs = [];
    return {
        OperationDefinition (node) {
            operationDefs.push(node);
            return false;
        },
        FragmentDefinition (node) {
            fragmentDefs.push(node);
            return false;
        },
        Document: {
            leave () {
                const fragmentNameUsed = Object.create(null);
                for (const operation of operationDefs){
                    for (const fragment of context.getRecursivelyReferencedFragments(operation)){
                        fragmentNameUsed[fragment.name.value] = true;
                    }
                }
                for (const fragmentDef of fragmentDefs){
                    const fragName = fragmentDef.name.value;
                    if (fragmentNameUsed[fragName] !== true) {
                        context.reportError(new GraphQLError(`Fragment "${fragName}" is never used.`, fragmentDef));
                    }
                }
            }
        }
    };
}
function PossibleFragmentSpreadsRule(context) {
    return {
        InlineFragment (node) {
            const fragType = context.getType();
            const parentType = context.getParentType();
            if (isCompositeType(fragType) && isCompositeType(parentType) && !doTypesOverlap(context.getSchema(), fragType, parentType)) {
                const parentTypeStr = inspect(parentType);
                const fragTypeStr = inspect(fragType);
                context.reportError(new GraphQLError(`Fragment cannot be spread here as objects of type "${parentTypeStr}" can never be of type "${fragTypeStr}".`, node));
            }
        },
        FragmentSpread (node) {
            const fragName = node.name.value;
            const fragType = getFragmentType(context, fragName);
            const parentType = context.getParentType();
            if (fragType && parentType && !doTypesOverlap(context.getSchema(), fragType, parentType)) {
                const parentTypeStr = inspect(parentType);
                const fragTypeStr = inspect(fragType);
                context.reportError(new GraphQLError(`Fragment "${fragName}" cannot be spread here as objects of type "${parentTypeStr}" can never be of type "${fragTypeStr}".`, node));
            }
        }
    };
}
function getFragmentType(context, name) {
    const frag = context.getFragment(name);
    if (frag) {
        const type = typeFromAST(context.getSchema(), frag.typeCondition);
        if (isCompositeType(type)) {
            return type;
        }
    }
}
function NoFragmentCyclesRule(context) {
    const visitedFrags = Object.create(null);
    const spreadPath = [];
    const spreadPathIndexByName = Object.create(null);
    return {
        OperationDefinition: ()=>false
        ,
        FragmentDefinition (node) {
            detectCycleRecursive(node);
            return false;
        }
    };
    function detectCycleRecursive(fragment) {
        if (visitedFrags[fragment.name.value]) {
            return;
        }
        const fragmentName = fragment.name.value;
        visitedFrags[fragmentName] = true;
        const spreadNodes = context.getFragmentSpreads(fragment.selectionSet);
        if (spreadNodes.length === 0) {
            return;
        }
        spreadPathIndexByName[fragmentName] = spreadPath.length;
        for (const spreadNode of spreadNodes){
            const spreadName = spreadNode.name.value;
            const cycleIndex = spreadPathIndexByName[spreadName];
            spreadPath.push(spreadNode);
            if (cycleIndex === undefined) {
                const spreadFragment = context.getFragment(spreadName);
                if (spreadFragment) {
                    detectCycleRecursive(spreadFragment);
                }
            } else {
                const cyclePath = spreadPath.slice(cycleIndex);
                const viaPath = cyclePath.slice(0, -1).map((s)=>'"' + s.name.value + '"'
                ).join(', ');
                context.reportError(new GraphQLError(`Cannot spread fragment "${spreadName}" within itself` + (viaPath !== '' ? ` via ${viaPath}.` : '.'), cyclePath));
            }
            spreadPath.pop();
        }
        spreadPathIndexByName[fragmentName] = undefined;
    }
}
function UniqueVariableNamesRule(context) {
    let knownVariableNames = Object.create(null);
    return {
        OperationDefinition () {
            knownVariableNames = Object.create(null);
        },
        VariableDefinition (node) {
            const variableName = node.variable.name.value;
            if (knownVariableNames[variableName]) {
                context.reportError(new GraphQLError(`There can be only one variable named "$${variableName}".`, [
                    knownVariableNames[variableName],
                    node.variable.name
                ]));
            } else {
                knownVariableNames[variableName] = node.variable.name;
            }
        }
    };
}
function NoUndefinedVariablesRule(context) {
    let variableNameDefined = Object.create(null);
    return {
        OperationDefinition: {
            enter () {
                variableNameDefined = Object.create(null);
            },
            leave (operation) {
                const usages = context.getRecursiveVariableUsages(operation);
                for (const { node  } of usages){
                    const varName = node.name.value;
                    if (variableNameDefined[varName] !== true) {
                        context.reportError(new GraphQLError(operation.name ? `Variable "$${varName}" is not defined by operation "${operation.name.value}".` : `Variable "$${varName}" is not defined.`, [
                            node,
                            operation
                        ]));
                    }
                }
            }
        },
        VariableDefinition (node) {
            variableNameDefined[node.variable.name.value] = true;
        }
    };
}
function NoUnusedVariablesRule(context) {
    let variableDefs = [];
    return {
        OperationDefinition: {
            enter () {
                variableDefs = [];
            },
            leave (operation) {
                const variableNameUsed = Object.create(null);
                const usages = context.getRecursiveVariableUsages(operation);
                for (const { node  } of usages){
                    variableNameUsed[node.name.value] = true;
                }
                for (const variableDef of variableDefs){
                    const variableName = variableDef.variable.name.value;
                    if (variableNameUsed[variableName] !== true) {
                        context.reportError(new GraphQLError(operation.name ? `Variable "$${variableName}" is never used in operation "${operation.name.value}".` : `Variable "$${variableName}" is never used.`, variableDef));
                    }
                }
            }
        },
        VariableDefinition (def) {
            variableDefs.push(def);
        }
    };
}
function KnownDirectivesRule(context) {
    const locationsMap = Object.create(null);
    const schema = context.getSchema();
    const definedDirectives = schema ? schema.getDirectives() : specifiedDirectives;
    for (const directive of definedDirectives){
        locationsMap[directive.name] = directive.locations;
    }
    const astDefinitions = context.getDocument().definitions;
    for (const def of astDefinitions){
        if (def.kind === Kind.DIRECTIVE_DEFINITION) {
            locationsMap[def.name.value] = def.locations.map((name)=>name.value
            );
        }
    }
    return {
        Directive (node, _key, _parent, _path, ancestors) {
            const name = node.name.value;
            const locations = locationsMap[name];
            if (!locations) {
                context.reportError(new GraphQLError(`Unknown directive "@${name}".`, node));
                return;
            }
            const candidateLocation = getDirectiveLocationForASTPath(ancestors);
            if (candidateLocation && locations.indexOf(candidateLocation) === -1) {
                context.reportError(new GraphQLError(`Directive "@${name}" may not be used on ${candidateLocation}.`, node));
            }
        }
    };
}
function getDirectiveLocationForASTPath(ancestors) {
    const appliedTo = ancestors[ancestors.length - 1];
    invariant(!Array.isArray(appliedTo));
    switch(appliedTo.kind){
        case Kind.OPERATION_DEFINITION:
            return getDirectiveLocationForOperation(appliedTo.operation);
        case Kind.FIELD:
            return DirectiveLocation.FIELD;
        case Kind.FRAGMENT_SPREAD:
            return DirectiveLocation.FRAGMENT_SPREAD;
        case Kind.INLINE_FRAGMENT:
            return DirectiveLocation.INLINE_FRAGMENT;
        case Kind.FRAGMENT_DEFINITION:
            return DirectiveLocation.FRAGMENT_DEFINITION;
        case Kind.VARIABLE_DEFINITION:
            return DirectiveLocation.VARIABLE_DEFINITION;
        case Kind.SCHEMA_DEFINITION:
        case Kind.SCHEMA_EXTENSION:
            return DirectiveLocation.SCHEMA;
        case Kind.SCALAR_TYPE_DEFINITION:
        case Kind.SCALAR_TYPE_EXTENSION:
            return DirectiveLocation.SCALAR;
        case Kind.OBJECT_TYPE_DEFINITION:
        case Kind.OBJECT_TYPE_EXTENSION:
            return DirectiveLocation.OBJECT;
        case Kind.FIELD_DEFINITION:
            return DirectiveLocation.FIELD_DEFINITION;
        case Kind.INTERFACE_TYPE_DEFINITION:
        case Kind.INTERFACE_TYPE_EXTENSION:
            return DirectiveLocation.INTERFACE;
        case Kind.UNION_TYPE_DEFINITION:
        case Kind.UNION_TYPE_EXTENSION:
            return DirectiveLocation.UNION;
        case Kind.ENUM_TYPE_DEFINITION:
        case Kind.ENUM_TYPE_EXTENSION:
            return DirectiveLocation.ENUM;
        case Kind.ENUM_VALUE_DEFINITION:
            return DirectiveLocation.ENUM_VALUE;
        case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        case Kind.INPUT_OBJECT_TYPE_EXTENSION:
            return DirectiveLocation.INPUT_OBJECT;
        case Kind.INPUT_VALUE_DEFINITION:
            {
                const parentNode = ancestors[ancestors.length - 3];
                return parentNode.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ? DirectiveLocation.INPUT_FIELD_DEFINITION : DirectiveLocation.ARGUMENT_DEFINITION;
            }
    }
}
function getDirectiveLocationForOperation(operation) {
    switch(operation){
        case 'query':
            return DirectiveLocation.QUERY;
        case 'mutation':
            return DirectiveLocation.MUTATION;
        case 'subscription':
            return DirectiveLocation.SUBSCRIPTION;
    }
    invariant(false, 'Unexpected operation: ' + inspect(operation));
}
function UniqueDirectivesPerLocationRule(context) {
    const uniqueDirectiveMap = Object.create(null);
    const schema = context.getSchema();
    const definedDirectives = schema ? schema.getDirectives() : specifiedDirectives;
    for (const directive1 of definedDirectives){
        uniqueDirectiveMap[directive1.name] = !directive1.isRepeatable;
    }
    const astDefinitions = context.getDocument().definitions;
    for (const def of astDefinitions){
        if (def.kind === Kind.DIRECTIVE_DEFINITION) {
            uniqueDirectiveMap[def.name.value] = !def.repeatable;
        }
    }
    const schemaDirectives = Object.create(null);
    const typeDirectivesMap = Object.create(null);
    return {
        enter (node) {
            if (node.directives == null) {
                return;
            }
            let seenDirectives;
            if (node.kind === Kind.SCHEMA_DEFINITION || node.kind === Kind.SCHEMA_EXTENSION) {
                seenDirectives = schemaDirectives;
            } else if (isTypeDefinitionNode(node) || isTypeExtensionNode(node)) {
                const typeName = node.name.value;
                seenDirectives = typeDirectivesMap[typeName];
                if (seenDirectives === undefined) {
                    typeDirectivesMap[typeName] = seenDirectives = Object.create(null);
                }
            } else {
                seenDirectives = Object.create(null);
            }
            for (const directive of node.directives){
                const directiveName = directive.name.value;
                if (uniqueDirectiveMap[directiveName]) {
                    if (seenDirectives[directiveName]) {
                        context.reportError(new GraphQLError(`The directive "@${directiveName}" can only be used once at this location.`, [
                            seenDirectives[directiveName],
                            directive
                        ]));
                    } else {
                        seenDirectives[directiveName] = directive;
                    }
                }
            }
        }
    };
}
function KnownArgumentNamesRule(context) {
    return {
        ...KnownArgumentNamesOnDirectivesRule(context),
        Argument (argNode) {
            const argDef = context.getArgument();
            const fieldDef = context.getFieldDef();
            const parentType = context.getParentType();
            if (!argDef && fieldDef && parentType) {
                const argName = argNode.name.value;
                const knownArgsNames = fieldDef.args.map((arg)=>arg.name
                );
                const suggestions = suggestionList(argName, knownArgsNames);
                context.reportError(new GraphQLError(`Unknown argument "${argName}" on field "${parentType.name}.${fieldDef.name}".` + didYouMean(suggestions), argNode));
            }
        }
    };
}
function KnownArgumentNamesOnDirectivesRule(context) {
    const directiveArgs = Object.create(null);
    const schema = context.getSchema();
    const definedDirectives = schema ? schema.getDirectives() : specifiedDirectives;
    for (const directive of definedDirectives){
        directiveArgs[directive.name] = directive.args.map((arg)=>arg.name
        );
    }
    const astDefinitions = context.getDocument().definitions;
    for (const def of astDefinitions){
        if (def.kind === Kind.DIRECTIVE_DEFINITION) {
            const argsNodes = def.arguments ?? [];
            directiveArgs[def.name.value] = argsNodes.map((arg)=>arg.name.value
            );
        }
    }
    return {
        Directive (directiveNode) {
            const directiveName = directiveNode.name.value;
            const knownArgs = directiveArgs[directiveName];
            if (directiveNode.arguments && knownArgs) {
                for (const argNode of directiveNode.arguments){
                    const argName = argNode.name.value;
                    if (knownArgs.indexOf(argName) === -1) {
                        const suggestions = suggestionList(argName, knownArgs);
                        context.reportError(new GraphQLError(`Unknown argument "${argName}" on directive "@${directiveName}".` + didYouMean(suggestions), argNode));
                    }
                }
            }
            return false;
        }
    };
}
function UniqueArgumentNamesRule(context) {
    let knownArgNames = Object.create(null);
    return {
        Field () {
            knownArgNames = Object.create(null);
        },
        Directive () {
            knownArgNames = Object.create(null);
        },
        Argument (node) {
            const argName = node.name.value;
            if (knownArgNames[argName]) {
                context.reportError(new GraphQLError(`There can be only one argument named "${argName}".`, [
                    knownArgNames[argName],
                    node.name
                ]));
            } else {
                knownArgNames[argName] = node.name;
            }
            return false;
        }
    };
}
function ValuesOfCorrectTypeRule(context) {
    return {
        ListValue (node) {
            const type = getNullableType(context.getParentInputType());
            if (!isListType(type)) {
                isValidValueNode(context, node);
                return false;
            }
        },
        ObjectValue (node) {
            const type = getNamedType(context.getInputType());
            if (!isInputObjectType(type)) {
                isValidValueNode(context, node);
                return false;
            }
            const fieldNodeMap = keyMap(node.fields, (field)=>field.name.value
            );
            for (const fieldDef of objectValues(type.getFields())){
                const fieldNode = fieldNodeMap[fieldDef.name];
                if (!fieldNode && isRequiredInputField(fieldDef)) {
                    const typeStr = inspect(fieldDef.type);
                    context.reportError(new GraphQLError(`Field "${type.name}.${fieldDef.name}" of required type "${typeStr}" was not provided.`, node));
                }
            }
        },
        ObjectField (node) {
            const parentType = getNamedType(context.getParentInputType());
            const fieldType = context.getInputType();
            if (!fieldType && isInputObjectType(parentType)) {
                const suggestions = suggestionList(node.name.value, Object.keys(parentType.getFields()));
                context.reportError(new GraphQLError(`Field "${node.name.value}" is not defined by type "${parentType.name}".` + didYouMean(suggestions), node));
            }
        },
        NullValue (node) {
            const type = context.getInputType();
            if (isNonNullType(type)) {
                context.reportError(new GraphQLError(`Expected value of type "${inspect(type)}", found ${print(node)}.`, node));
            }
        },
        EnumValue: (node)=>isValidValueNode(context, node)
        ,
        IntValue: (node)=>isValidValueNode(context, node)
        ,
        FloatValue: (node)=>isValidValueNode(context, node)
        ,
        StringValue: (node)=>isValidValueNode(context, node)
        ,
        BooleanValue: (node)=>isValidValueNode(context, node)
    };
}
function isValidValueNode(context, node) {
    const locationType = context.getInputType();
    if (!locationType) {
        return;
    }
    const type = getNamedType(locationType);
    if (!isLeafType(type)) {
        const typeStr = inspect(locationType);
        context.reportError(new GraphQLError(`Expected value of type "${typeStr}", found ${print(node)}.`, node));
        return;
    }
    try {
        const parseResult = type.parseLiteral(node, undefined);
        if (parseResult === undefined) {
            const typeStr = inspect(locationType);
            context.reportError(new GraphQLError(`Expected value of type "${typeStr}", found ${print(node)}.`, node));
        }
    } catch (error) {
        const typeStr = inspect(locationType);
        if (error instanceof GraphQLError) {
            context.reportError(error);
        } else {
            context.reportError(new GraphQLError(`Expected value of type "${typeStr}", found ${print(node)}; ` + error.message, node, undefined, undefined, undefined, error));
        }
    }
}
function ProvidedRequiredArgumentsRule(context) {
    return {
        ...ProvidedRequiredArgumentsOnDirectivesRule(context),
        Field: {
            leave (fieldNode) {
                const fieldDef = context.getFieldDef();
                if (!fieldDef) {
                    return false;
                }
                const argNodes = fieldNode.arguments ?? [];
                const argNodeMap = keyMap(argNodes, (arg)=>arg.name.value
                );
                for (const argDef of fieldDef.args){
                    const argNode = argNodeMap[argDef.name];
                    if (!argNode && isRequiredArgument(argDef)) {
                        const argTypeStr = inspect(argDef.type);
                        context.reportError(new GraphQLError(`Field "${fieldDef.name}" argument "${argDef.name}" of type "${argTypeStr}" is required, but it was not provided.`, fieldNode));
                    }
                }
            }
        }
    };
}
function ProvidedRequiredArgumentsOnDirectivesRule(context) {
    const requiredArgsMap = Object.create(null);
    const schema = context.getSchema();
    const definedDirectives = schema ? schema.getDirectives() : specifiedDirectives;
    for (const directive of definedDirectives){
        requiredArgsMap[directive.name] = keyMap(directive.args.filter(isRequiredArgument), (arg)=>arg.name
        );
    }
    const astDefinitions = context.getDocument().definitions;
    for (const def of astDefinitions){
        if (def.kind === Kind.DIRECTIVE_DEFINITION) {
            const argNodes = def.arguments ?? [];
            requiredArgsMap[def.name.value] = keyMap(argNodes.filter(isRequiredArgumentNode), (arg)=>arg.name.value
            );
        }
    }
    return {
        Directive: {
            leave (directiveNode) {
                const directiveName = directiveNode.name.value;
                const requiredArgs = requiredArgsMap[directiveName];
                if (requiredArgs) {
                    const argNodes = directiveNode.arguments ?? [];
                    const argNodeMap = keyMap(argNodes, (arg)=>arg.name.value
                    );
                    for (const argName of Object.keys(requiredArgs)){
                        if (!argNodeMap[argName]) {
                            const argType = requiredArgs[argName].type;
                            const argTypeStr = isType(argType) ? inspect(argType) : print(argType);
                            context.reportError(new GraphQLError(`Directive "@${directiveName}" argument "${argName}" of type "${argTypeStr}" is required, but it was not provided.`, directiveNode));
                        }
                    }
                }
            }
        }
    };
}
function isRequiredArgumentNode(arg) {
    return arg.type.kind === Kind.NON_NULL_TYPE && arg.defaultValue == null;
}
function VariablesInAllowedPositionRule(context) {
    let varDefMap = Object.create(null);
    return {
        OperationDefinition: {
            enter () {
                varDefMap = Object.create(null);
            },
            leave (operation) {
                const usages = context.getRecursiveVariableUsages(operation);
                for (const { node , type , defaultValue  } of usages){
                    const varName = node.name.value;
                    const varDef = varDefMap[varName];
                    if (varDef && type) {
                        const schema = context.getSchema();
                        const varType = typeFromAST(schema, varDef.type);
                        if (varType && !allowedVariableUsage(schema, varType, varDef.defaultValue, type, defaultValue)) {
                            const varTypeStr = inspect(varType);
                            const typeStr = inspect(type);
                            context.reportError(new GraphQLError(`Variable "$${varName}" of type "${varTypeStr}" used in position expecting type "${typeStr}".`, [
                                varDef,
                                node
                            ]));
                        }
                    }
                }
            }
        },
        VariableDefinition (node) {
            varDefMap[node.variable.name.value] = node;
        }
    };
}
function allowedVariableUsage(schema, varType, varDefaultValue, locationType, locationDefaultValue) {
    if (isNonNullType(locationType) && !isNonNullType(varType)) {
        const hasNonNullVariableDefaultValue = varDefaultValue != null && varDefaultValue.kind !== Kind.NULL;
        const hasLocationDefaultValue = locationDefaultValue !== undefined;
        if (!hasNonNullVariableDefaultValue && !hasLocationDefaultValue) {
            return false;
        }
        const nullableLocationType = locationType.ofType;
        return isTypeSubTypeOf(schema, varType, nullableLocationType);
    }
    return isTypeSubTypeOf(schema, varType, locationType);
}
function reasonMessage(reason) {
    if (Array.isArray(reason)) {
        return reason.map(([responseName, subReason])=>`subfields "${responseName}" conflict because ` + reasonMessage(subReason)
        ).join(' and ');
    }
    return reason;
}
function OverlappingFieldsCanBeMergedRule(context) {
    const comparedFragmentPairs = new PairSet();
    const cachedFieldsAndFragmentNames = new Map();
    return {
        SelectionSet (selectionSet) {
            const conflicts = findConflictsWithinSelectionSet(context, cachedFieldsAndFragmentNames, comparedFragmentPairs, context.getParentType(), selectionSet);
            for (const [[responseName, reason], fields1, fields2] of conflicts){
                const reasonMsg = reasonMessage(reason);
                context.reportError(new GraphQLError(`Fields "${responseName}" conflict because ${reasonMsg}. Use different aliases on the fields to fetch both if this was intentional.`, fields1.concat(fields2)));
            }
        }
    };
}
function findConflictsWithinSelectionSet(context, cachedFieldsAndFragmentNames, comparedFragmentPairs, parentType, selectionSet) {
    const conflicts = [];
    const [fieldMap, fragmentNames] = getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType, selectionSet);
    collectConflictsWithin(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, fieldMap);
    if (fragmentNames.length !== 0) {
        for(let i = 0; i < fragmentNames.length; i++){
            collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, false, fieldMap, fragmentNames[i]);
            for(let j = i + 1; j < fragmentNames.length; j++){
                collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, false, fragmentNames[i], fragmentNames[j]);
            }
        }
    }
    return conflicts;
}
function collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fieldMap, fragmentName) {
    const fragment = context.getFragment(fragmentName);
    if (!fragment) {
        return;
    }
    const [fieldMap2, fragmentNames2] = getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment);
    if (fieldMap === fieldMap2) {
        return;
    }
    collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fieldMap, fieldMap2);
    for(let i = 0; i < fragmentNames2.length; i++){
        collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fieldMap, fragmentNames2[i]);
    }
}
function collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fragmentName1, fragmentName2) {
    if (fragmentName1 === fragmentName2) {
        return;
    }
    if (comparedFragmentPairs.has(fragmentName1, fragmentName2, areMutuallyExclusive)) {
        return;
    }
    comparedFragmentPairs.add(fragmentName1, fragmentName2, areMutuallyExclusive);
    const fragment1 = context.getFragment(fragmentName1);
    const fragment2 = context.getFragment(fragmentName2);
    if (!fragment1 || !fragment2) {
        return;
    }
    const [fieldMap1, fragmentNames1] = getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment1);
    const [fieldMap2, fragmentNames2] = getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment2);
    collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fieldMap1, fieldMap2);
    for(let j = 0; j < fragmentNames2.length; j++){
        collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fragmentName1, fragmentNames2[j]);
    }
    for(let i = 0; i < fragmentNames1.length; i++){
        collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fragmentNames1[i], fragmentName2);
    }
}
function findConflictsBetweenSubSelectionSets(context, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, parentType1, selectionSet1, parentType2, selectionSet2) {
    const conflicts = [];
    const [fieldMap1, fragmentNames1] = getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType1, selectionSet1);
    const [fieldMap2, fragmentNames2] = getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType2, selectionSet2);
    collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fieldMap1, fieldMap2);
    if (fragmentNames2.length !== 0) {
        for(let j = 0; j < fragmentNames2.length; j++){
            collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fieldMap1, fragmentNames2[j]);
        }
    }
    if (fragmentNames1.length !== 0) {
        for(let i = 0; i < fragmentNames1.length; i++){
            collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fieldMap2, fragmentNames1[i]);
        }
    }
    for(let i = 0; i < fragmentNames1.length; i++){
        for(let j = 0; j < fragmentNames2.length; j++){
            collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, fragmentNames1[i], fragmentNames2[j]);
        }
    }
    return conflicts;
}
function collectConflictsWithin(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, fieldMap) {
    for (const [responseName, fields] of objectEntries(fieldMap)){
        if (fields.length > 1) {
            for(let i = 0; i < fields.length; i++){
                for(let j = i + 1; j < fields.length; j++){
                    const conflict = findConflict(context, cachedFieldsAndFragmentNames, comparedFragmentPairs, false, responseName, fields[i], fields[j]);
                    if (conflict) {
                        conflicts.push(conflict);
                    }
                }
            }
        }
    }
}
function collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFragmentPairs, parentFieldsAreMutuallyExclusive, fieldMap1, fieldMap2) {
    for (const responseName of Object.keys(fieldMap1)){
        const fields2 = fieldMap2[responseName];
        if (fields2) {
            const fields1 = fieldMap1[responseName];
            for(let i = 0; i < fields1.length; i++){
                for(let j = 0; j < fields2.length; j++){
                    const conflict = findConflict(context, cachedFieldsAndFragmentNames, comparedFragmentPairs, parentFieldsAreMutuallyExclusive, responseName, fields1[i], fields2[j]);
                    if (conflict) {
                        conflicts.push(conflict);
                    }
                }
            }
        }
    }
}
function findConflict(context, cachedFieldsAndFragmentNames, comparedFragmentPairs, parentFieldsAreMutuallyExclusive, responseName, field1, field2) {
    const [parentType1, node1, def1] = field1;
    const [parentType2, node2, def2] = field2;
    const areMutuallyExclusive = parentFieldsAreMutuallyExclusive || parentType1 !== parentType2 && isObjectType(parentType1) && isObjectType(parentType2);
    if (!areMutuallyExclusive) {
        const name1 = node1.name.value;
        const name2 = node2.name.value;
        if (name1 !== name2) {
            return [
                [
                    responseName,
                    `"${name1}" and "${name2}" are different fields`
                ],
                [
                    node1
                ],
                [
                    node2
                ]
            ];
        }
        const args1 = node1.arguments ?? [];
        const args2 = node2.arguments ?? [];
        if (!sameArguments(args1, args2)) {
            return [
                [
                    responseName,
                    'they have differing arguments'
                ],
                [
                    node1
                ],
                [
                    node2
                ]
            ];
        }
    }
    const type1 = def1?.type;
    const type2 = def2?.type;
    if (type1 && type2 && doTypesConflict(type1, type2)) {
        return [
            [
                responseName,
                `they return conflicting types "${inspect(type1)}" and "${inspect(type2)}"`
            ],
            [
                node1
            ],
            [
                node2
            ]
        ];
    }
    const selectionSet1 = node1.selectionSet;
    const selectionSet2 = node2.selectionSet;
    if (selectionSet1 && selectionSet2) {
        const conflicts = findConflictsBetweenSubSelectionSets(context, cachedFieldsAndFragmentNames, comparedFragmentPairs, areMutuallyExclusive, getNamedType(type1), selectionSet1, getNamedType(type2), selectionSet2);
        return subfieldConflicts(conflicts, responseName, node1, node2);
    }
}
function sameArguments(arguments1, arguments2) {
    if (arguments1.length !== arguments2.length) {
        return false;
    }
    return arguments1.every((argument1)=>{
        const argument2 = find(arguments2, (argument)=>argument.name.value === argument1.name.value
        );
        if (!argument2) {
            return false;
        }
        return sameValue(argument1.value, argument2.value);
    });
}
function sameValue(value1, value2) {
    return print(value1) === print(value2);
}
function doTypesConflict(type1, type2) {
    if (isListType(type1)) {
        return isListType(type2) ? doTypesConflict(type1.ofType, type2.ofType) : true;
    }
    if (isListType(type2)) {
        return true;
    }
    if (isNonNullType(type1)) {
        return isNonNullType(type2) ? doTypesConflict(type1.ofType, type2.ofType) : true;
    }
    if (isNonNullType(type2)) {
        return true;
    }
    if (isLeafType(type1) || isLeafType(type2)) {
        return type1 !== type2;
    }
    return false;
}
function getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType, selectionSet) {
    let cached = cachedFieldsAndFragmentNames.get(selectionSet);
    if (!cached) {
        const nodeAndDefs = Object.create(null);
        const fragmentNames = Object.create(null);
        _collectFieldsAndFragmentNames(context, parentType, selectionSet, nodeAndDefs, fragmentNames);
        cached = [
            nodeAndDefs,
            Object.keys(fragmentNames)
        ];
        cachedFieldsAndFragmentNames.set(selectionSet, cached);
    }
    return cached;
}
function getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment) {
    const cached = cachedFieldsAndFragmentNames.get(fragment.selectionSet);
    if (cached) {
        return cached;
    }
    const fragmentType = typeFromAST(context.getSchema(), fragment.typeCondition);
    return getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragmentType, fragment.selectionSet);
}
function _collectFieldsAndFragmentNames(context, parentType, selectionSet, nodeAndDefs, fragmentNames) {
    for (const selection of selectionSet.selections){
        switch(selection.kind){
            case Kind.FIELD:
                {
                    const fieldName = selection.name.value;
                    let fieldDef;
                    if (isObjectType(parentType) || isInterfaceType(parentType)) {
                        fieldDef = parentType.getFields()[fieldName];
                    }
                    const responseName = selection.alias ? selection.alias.value : fieldName;
                    if (!nodeAndDefs[responseName]) {
                        nodeAndDefs[responseName] = [];
                    }
                    nodeAndDefs[responseName].push([
                        parentType,
                        selection,
                        fieldDef
                    ]);
                    break;
                }
            case Kind.FRAGMENT_SPREAD:
                fragmentNames[selection.name.value] = true;
                break;
            case Kind.INLINE_FRAGMENT:
                {
                    const typeCondition = selection.typeCondition;
                    const inlineFragmentType = typeCondition ? typeFromAST(context.getSchema(), typeCondition) : parentType;
                    _collectFieldsAndFragmentNames(context, inlineFragmentType, selection.selectionSet, nodeAndDefs, fragmentNames);
                    break;
                }
        }
    }
}
function subfieldConflicts(conflicts, responseName, node1, node2) {
    if (conflicts.length > 0) {
        return [
            [
                responseName,
                conflicts.map(([reason])=>reason
                )
            ],
            conflicts.reduce((allFields, [, fields1])=>allFields.concat(fields1)
            , [
                node1
            ]),
            conflicts.reduce((allFields, [, , fields2])=>allFields.concat(fields2)
            , [
                node2
            ])
        ];
    }
}
class PairSet {
    constructor(){
        this._data = Object.create(null);
    }
    has(a, b, areMutuallyExclusive) {
        const first = this._data[a];
        const result = first && first[b];
        if (result === undefined) {
            return false;
        }
        if (areMutuallyExclusive === false) {
            return result === false;
        }
        return true;
    }
    add(a, b, areMutuallyExclusive) {
        _pairSetAdd(this._data, a, b, areMutuallyExclusive);
        _pairSetAdd(this._data, b, a, areMutuallyExclusive);
    }
}
function _pairSetAdd(data, a, b, areMutuallyExclusive) {
    let map = data[a];
    if (!map) {
        map = Object.create(null);
        data[a] = map;
    }
    map[b] = areMutuallyExclusive;
}
function UniqueInputFieldNamesRule(context) {
    const knownNameStack = [];
    let knownNames = Object.create(null);
    return {
        ObjectValue: {
            enter () {
                knownNameStack.push(knownNames);
                knownNames = Object.create(null);
            },
            leave () {
                knownNames = knownNameStack.pop();
            }
        },
        ObjectField (node) {
            const fieldName = node.name.value;
            if (knownNames[fieldName]) {
                context.reportError(new GraphQLError(`There can be only one input field named "${fieldName}".`, [
                    knownNames[fieldName],
                    node.name
                ]));
            } else {
                knownNames[fieldName] = node.name;
            }
        }
    };
}
function LoneSchemaDefinitionRule(context) {
    const oldSchema = context.getSchema();
    const alreadyDefined = ((oldSchema?.astNode ?? oldSchema?.getQueryType()) ?? oldSchema?.getMutationType()) ?? oldSchema?.getSubscriptionType();
    let schemaDefinitionsCount = 0;
    return {
        SchemaDefinition (node) {
            if (alreadyDefined) {
                context.reportError(new GraphQLError('Cannot define a new schema within a schema extension.', node));
                return;
            }
            if (schemaDefinitionsCount > 0) {
                context.reportError(new GraphQLError('Must provide only one schema definition.', node));
            }
            ++schemaDefinitionsCount;
        }
    };
}
function UniqueOperationTypesRule(context) {
    const schema = context.getSchema();
    const definedOperationTypes = Object.create(null);
    const existingOperationTypes = schema ? {
        query: schema.getQueryType(),
        mutation: schema.getMutationType(),
        subscription: schema.getSubscriptionType()
    } : {};
    return {
        SchemaDefinition: checkOperationTypes,
        SchemaExtension: checkOperationTypes
    };
    function checkOperationTypes(node) {
        const operationTypesNodes = node.operationTypes ?? [];
        for (const operationType of operationTypesNodes){
            const operation = operationType.operation;
            const alreadyDefinedOperationType = definedOperationTypes[operation];
            if (existingOperationTypes[operation]) {
                context.reportError(new GraphQLError(`Type for ${operation} already defined in the schema. It cannot be redefined.`, operationType));
            } else if (alreadyDefinedOperationType) {
                context.reportError(new GraphQLError(`There can be only one ${operation} type in schema.`, [
                    alreadyDefinedOperationType,
                    operationType
                ]));
            } else {
                definedOperationTypes[operation] = operationType;
            }
        }
        return false;
    }
}
function UniqueTypeNamesRule(context) {
    const knownTypeNames = Object.create(null);
    const schema = context.getSchema();
    return {
        ScalarTypeDefinition: checkTypeName,
        ObjectTypeDefinition: checkTypeName,
        InterfaceTypeDefinition: checkTypeName,
        UnionTypeDefinition: checkTypeName,
        EnumTypeDefinition: checkTypeName,
        InputObjectTypeDefinition: checkTypeName
    };
    function checkTypeName(node) {
        const typeName = node.name.value;
        if (schema?.getType(typeName)) {
            context.reportError(new GraphQLError(`Type "${typeName}" already exists in the schema. It cannot also be defined in this type definition.`, node.name));
            return;
        }
        if (knownTypeNames[typeName]) {
            context.reportError(new GraphQLError(`There can be only one type named "${typeName}".`, [
                knownTypeNames[typeName],
                node.name
            ]));
        } else {
            knownTypeNames[typeName] = node.name;
        }
        return false;
    }
}
function UniqueEnumValueNamesRule(context) {
    const schema = context.getSchema();
    const existingTypeMap = schema ? schema.getTypeMap() : Object.create(null);
    const knownValueNames = Object.create(null);
    return {
        EnumTypeDefinition: checkValueUniqueness,
        EnumTypeExtension: checkValueUniqueness
    };
    function checkValueUniqueness(node) {
        const typeName = node.name.value;
        if (!knownValueNames[typeName]) {
            knownValueNames[typeName] = Object.create(null);
        }
        const valueNodes = node.values ?? [];
        const valueNames = knownValueNames[typeName];
        for (const valueDef of valueNodes){
            const valueName = valueDef.name.value;
            const existingType = existingTypeMap[typeName];
            if (isEnumType(existingType) && existingType.getValue(valueName)) {
                context.reportError(new GraphQLError(`Enum value "${typeName}.${valueName}" already exists in the schema. It cannot also be defined in this type extension.`, valueDef.name));
            } else if (valueNames[valueName]) {
                context.reportError(new GraphQLError(`Enum value "${typeName}.${valueName}" can only be defined once.`, [
                    valueNames[valueName],
                    valueDef.name
                ]));
            } else {
                valueNames[valueName] = valueDef.name;
            }
        }
        return false;
    }
}
function UniqueFieldDefinitionNamesRule(context) {
    const schema = context.getSchema();
    const existingTypeMap = schema ? schema.getTypeMap() : Object.create(null);
    const knownFieldNames = Object.create(null);
    return {
        InputObjectTypeDefinition: checkFieldUniqueness,
        InputObjectTypeExtension: checkFieldUniqueness,
        InterfaceTypeDefinition: checkFieldUniqueness,
        InterfaceTypeExtension: checkFieldUniqueness,
        ObjectTypeDefinition: checkFieldUniqueness,
        ObjectTypeExtension: checkFieldUniqueness
    };
    function checkFieldUniqueness(node) {
        const typeName = node.name.value;
        if (!knownFieldNames[typeName]) {
            knownFieldNames[typeName] = Object.create(null);
        }
        const fieldNodes = node.fields ?? [];
        const fieldNames = knownFieldNames[typeName];
        for (const fieldDef of fieldNodes){
            const fieldName = fieldDef.name.value;
            if (hasField(existingTypeMap[typeName], fieldName)) {
                context.reportError(new GraphQLError(`Field "${typeName}.${fieldName}" already exists in the schema. It cannot also be defined in this type extension.`, fieldDef.name));
            } else if (fieldNames[fieldName]) {
                context.reportError(new GraphQLError(`Field "${typeName}.${fieldName}" can only be defined once.`, [
                    fieldNames[fieldName],
                    fieldDef.name
                ]));
            } else {
                fieldNames[fieldName] = fieldDef.name;
            }
        }
        return false;
    }
}
function hasField(type, fieldName) {
    if (isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)) {
        return type.getFields()[fieldName];
    }
    return false;
}
function UniqueDirectiveNamesRule(context) {
    const knownDirectiveNames = Object.create(null);
    const schema = context.getSchema();
    return {
        DirectiveDefinition (node) {
            const directiveName = node.name.value;
            if (schema?.getDirective(directiveName)) {
                context.reportError(new GraphQLError(`Directive "@${directiveName}" already exists in the schema. It cannot be redefined.`, node.name));
                return;
            }
            if (knownDirectiveNames[directiveName]) {
                context.reportError(new GraphQLError(`There can be only one directive named "@${directiveName}".`, [
                    knownDirectiveNames[directiveName],
                    node.name
                ]));
            } else {
                knownDirectiveNames[directiveName] = node.name;
            }
            return false;
        }
    };
}
function PossibleTypeExtensionsRule(context) {
    const schema = context.getSchema();
    const definedTypes = Object.create(null);
    for (const def of context.getDocument().definitions){
        if (isTypeDefinitionNode(def)) {
            definedTypes[def.name.value] = def;
        }
    }
    return {
        ScalarTypeExtension: checkExtension,
        ObjectTypeExtension: checkExtension,
        InterfaceTypeExtension: checkExtension,
        UnionTypeExtension: checkExtension,
        EnumTypeExtension: checkExtension,
        InputObjectTypeExtension: checkExtension
    };
    function checkExtension(node) {
        const typeName = node.name.value;
        const defNode = definedTypes[typeName];
        const existingType = schema?.getType(typeName);
        let expectedKind;
        if (defNode) {
            expectedKind = defKindToExtKind[defNode.kind];
        } else if (existingType) {
            expectedKind = typeToExtKind(existingType);
        }
        if (expectedKind) {
            if (expectedKind !== node.kind) {
                const kindStr = extensionKindToTypeName(node.kind);
                context.reportError(new GraphQLError(`Cannot extend non-${kindStr} type "${typeName}".`, defNode ? [
                    defNode,
                    node
                ] : node));
            }
        } else {
            let allTypeNames = Object.keys(definedTypes);
            if (schema) {
                allTypeNames = allTypeNames.concat(Object.keys(schema.getTypeMap()));
            }
            const suggestedTypes = suggestionList(typeName, allTypeNames);
            context.reportError(new GraphQLError(`Cannot extend type "${typeName}" because it is not defined.` + didYouMean(suggestedTypes), node.name));
        }
    }
}
const defKindToExtKind = {
    [Kind.SCALAR_TYPE_DEFINITION]: Kind.SCALAR_TYPE_EXTENSION,
    [Kind.OBJECT_TYPE_DEFINITION]: Kind.OBJECT_TYPE_EXTENSION,
    [Kind.INTERFACE_TYPE_DEFINITION]: Kind.INTERFACE_TYPE_EXTENSION,
    [Kind.UNION_TYPE_DEFINITION]: Kind.UNION_TYPE_EXTENSION,
    [Kind.ENUM_TYPE_DEFINITION]: Kind.ENUM_TYPE_EXTENSION,
    [Kind.INPUT_OBJECT_TYPE_DEFINITION]: Kind.INPUT_OBJECT_TYPE_EXTENSION
};
function typeToExtKind(type) {
    if (isScalarType(type)) {
        return Kind.SCALAR_TYPE_EXTENSION;
    }
    if (isObjectType(type)) {
        return Kind.OBJECT_TYPE_EXTENSION;
    }
    if (isInterfaceType(type)) {
        return Kind.INTERFACE_TYPE_EXTENSION;
    }
    if (isUnionType(type)) {
        return Kind.UNION_TYPE_EXTENSION;
    }
    if (isEnumType(type)) {
        return Kind.ENUM_TYPE_EXTENSION;
    }
    if (isInputObjectType(type)) {
        return Kind.INPUT_OBJECT_TYPE_EXTENSION;
    }
    invariant(false, 'Unexpected type: ' + inspect(type));
}
function extensionKindToTypeName(kind) {
    switch(kind){
        case Kind.SCALAR_TYPE_EXTENSION:
            return 'scalar';
        case Kind.OBJECT_TYPE_EXTENSION:
            return 'object';
        case Kind.INTERFACE_TYPE_EXTENSION:
            return 'interface';
        case Kind.UNION_TYPE_EXTENSION:
            return 'union';
        case Kind.ENUM_TYPE_EXTENSION:
            return 'enum';
        case Kind.INPUT_OBJECT_TYPE_EXTENSION:
            return 'input object';
    }
    invariant(false, 'Unexpected kind: ' + inspect(kind));
}
const specifiedRules = Object.freeze([
    ExecutableDefinitionsRule,
    UniqueOperationNamesRule,
    LoneAnonymousOperationRule,
    SingleFieldSubscriptionsRule,
    KnownTypeNamesRule,
    FragmentsOnCompositeTypesRule,
    VariablesAreInputTypesRule,
    ScalarLeafsRule,
    FieldsOnCorrectTypeRule,
    UniqueFragmentNamesRule,
    KnownFragmentNamesRule,
    NoUnusedFragmentsRule,
    PossibleFragmentSpreadsRule,
    NoFragmentCyclesRule,
    UniqueVariableNamesRule,
    NoUndefinedVariablesRule,
    NoUnusedVariablesRule,
    KnownDirectivesRule,
    UniqueDirectivesPerLocationRule,
    KnownArgumentNamesRule,
    UniqueArgumentNamesRule,
    ValuesOfCorrectTypeRule,
    ProvidedRequiredArgumentsRule,
    VariablesInAllowedPositionRule,
    OverlappingFieldsCanBeMergedRule,
    UniqueInputFieldNamesRule
]);
const specifiedSDLRules = Object.freeze([
    LoneSchemaDefinitionRule,
    UniqueOperationTypesRule,
    UniqueTypeNamesRule,
    UniqueEnumValueNamesRule,
    UniqueFieldDefinitionNamesRule,
    UniqueDirectiveNamesRule,
    KnownTypeNamesRule,
    KnownDirectivesRule,
    UniqueDirectivesPerLocationRule,
    PossibleTypeExtensionsRule,
    KnownArgumentNamesOnDirectivesRule,
    UniqueArgumentNamesRule,
    UniqueInputFieldNamesRule,
    ProvidedRequiredArgumentsOnDirectivesRule
]);
class ASTValidationContext {
    constructor(ast, onError){
        this._ast = ast;
        this._fragments = undefined;
        this._fragmentSpreads = new Map();
        this._recursivelyReferencedFragments = new Map();
        this._onError = onError;
    }
    reportError(error) {
        this._onError(error);
    }
    getDocument() {
        return this._ast;
    }
    getFragment(name) {
        let fragments = this._fragments;
        if (!fragments) {
            this._fragments = fragments = this.getDocument().definitions.reduce((frags, statement)=>{
                if (statement.kind === Kind.FRAGMENT_DEFINITION) {
                    frags[statement.name.value] = statement;
                }
                return frags;
            }, Object.create(null));
        }
        return fragments[name];
    }
    getFragmentSpreads(node) {
        let spreads = this._fragmentSpreads.get(node);
        if (!spreads) {
            spreads = [];
            const setsToVisit = [
                node
            ];
            while(setsToVisit.length !== 0){
                const set = setsToVisit.pop();
                for (const selection of set.selections){
                    if (selection.kind === Kind.FRAGMENT_SPREAD) {
                        spreads.push(selection);
                    } else if (selection.selectionSet) {
                        setsToVisit.push(selection.selectionSet);
                    }
                }
            }
            this._fragmentSpreads.set(node, spreads);
        }
        return spreads;
    }
    getRecursivelyReferencedFragments(operation) {
        let fragments = this._recursivelyReferencedFragments.get(operation);
        if (!fragments) {
            fragments = [];
            const collectedNames = Object.create(null);
            const nodesToVisit = [
                operation.selectionSet
            ];
            while(nodesToVisit.length !== 0){
                const node = nodesToVisit.pop();
                for (const spread of this.getFragmentSpreads(node)){
                    const fragName = spread.name.value;
                    if (collectedNames[fragName] !== true) {
                        collectedNames[fragName] = true;
                        const fragment = this.getFragment(fragName);
                        if (fragment) {
                            fragments.push(fragment);
                            nodesToVisit.push(fragment.selectionSet);
                        }
                    }
                }
            }
            this._recursivelyReferencedFragments.set(operation, fragments);
        }
        return fragments;
    }
}
class SDLValidationContext extends ASTValidationContext {
    constructor(ast, schema, onError){
        super(ast, onError);
        this._schema = schema;
    }
    getSchema() {
        return this._schema;
    }
}
class ValidationContext extends ASTValidationContext {
    constructor(schema, ast, typeInfo, onError){
        super(ast, onError);
        this._schema = schema;
        this._typeInfo = typeInfo;
        this._variableUsages = new Map();
        this._recursiveVariableUsages = new Map();
    }
    getSchema() {
        return this._schema;
    }
    getVariableUsages(node) {
        let usages = this._variableUsages.get(node);
        if (!usages) {
            const newUsages = [];
            const typeInfo = new TypeInfo(this._schema);
            visit(node, visitWithTypeInfo(typeInfo, {
                VariableDefinition: ()=>false
                ,
                Variable (variable) {
                    newUsages.push({
                        node: variable,
                        type: typeInfo.getInputType(),
                        defaultValue: typeInfo.getDefaultValue()
                    });
                }
            }));
            usages = newUsages;
            this._variableUsages.set(node, usages);
        }
        return usages;
    }
    getRecursiveVariableUsages(operation) {
        let usages = this._recursiveVariableUsages.get(operation);
        if (!usages) {
            usages = this.getVariableUsages(operation);
            for (const frag of this.getRecursivelyReferencedFragments(operation)){
                usages = usages.concat(this.getVariableUsages(frag));
            }
            this._recursiveVariableUsages.set(operation, usages);
        }
        return usages;
    }
    getType() {
        return this._typeInfo.getType();
    }
    getParentType() {
        return this._typeInfo.getParentType();
    }
    getInputType() {
        return this._typeInfo.getInputType();
    }
    getParentInputType() {
        return this._typeInfo.getParentInputType();
    }
    getFieldDef() {
        return this._typeInfo.getFieldDef();
    }
    getDirective() {
        return this._typeInfo.getDirective();
    }
    getArgument() {
        return this._typeInfo.getArgument();
    }
}
function validate(schema, documentAST, rules = specifiedRules, typeInfo = new TypeInfo(schema), options = {
    maxErrors: undefined
}) {
    devAssert(documentAST, 'Must provide document.');
    assertValidSchema(schema);
    const abortObj = Object.freeze({});
    const errors = [];
    const context = new ValidationContext(schema, documentAST, typeInfo, (error)=>{
        if (options.maxErrors != null && errors.length >= options.maxErrors) {
            errors.push(new GraphQLError('Too many validation errors, error limit reached. Validation aborted.'));
            throw abortObj;
        }
        errors.push(error);
    });
    const visitor = visitInParallel(rules.map((rule)=>rule(context)
    ));
    try {
        visit(documentAST, visitWithTypeInfo(typeInfo, visitor));
    } catch (e) {
        if (e !== abortObj) {
            throw e;
        }
    }
    return errors;
}
function validateSDL(documentAST, schemaToExtend, rules = specifiedSDLRules) {
    const errors = [];
    const context = new SDLValidationContext(documentAST, schemaToExtend, (error)=>{
        errors.push(error);
    });
    const visitors = rules.map((rule)=>rule(context)
    );
    visit(documentAST, visitInParallel(visitors));
    return errors;
}
function assertValidSDL(documentAST) {
    const errors = validateSDL(documentAST);
    if (errors.length !== 0) {
        throw new Error(errors.map((error)=>error.message
        ).join('\n\n'));
    }
}
function assertValidSDLExtension(documentAST, schema) {
    const errors = validateSDL(documentAST, schema);
    if (errors.length !== 0) {
        throw new Error(errors.map((error)=>error.message
        ).join('\n\n'));
    }
}
function memoize3(fn) {
    let cache0;
    function memoized(a1, a2, a3) {
        if (!cache0) {
            cache0 = new WeakMap();
        }
        let cache1 = cache0.get(a1);
        let cache2;
        if (cache1) {
            cache2 = cache1.get(a2);
            if (cache2) {
                const cachedValue = cache2.get(a3);
                if (cachedValue !== undefined) {
                    return cachedValue;
                }
            }
        } else {
            cache1 = new WeakMap();
            cache0.set(a1, cache1);
        }
        if (!cache2) {
            cache2 = new WeakMap();
            cache1.set(a2, cache2);
        }
        const newValue = fn(a1, a2, a3);
        cache2.set(a3, newValue);
        return newValue;
    }
    return memoized;
}
function promiseReduce(values, callback, initialValue) {
    return values.reduce((previous, value)=>isPromise(previous) ? previous.then((resolved)=>callback(resolved, value)
        ) : callback(previous, value)
    , initialValue);
}
function promiseForObject(object) {
    const keys = Object.keys(object);
    const valuesAndPromises = keys.map((name)=>object[name]
    );
    return Promise.all(valuesAndPromises).then((values)=>values.reduce((resolvedObject, value, i)=>{
            resolvedObject[keys[i]] = value;
            return resolvedObject;
        }, Object.create(null))
    );
}
function addPath(prev, key) {
    return {
        prev,
        key
    };
}
function pathToArray(path) {
    const flattened = [];
    let curr = path;
    while(curr){
        flattened.push(curr.key);
        curr = curr.prev;
    }
    return flattened.reverse();
}
function getOperationRootType(schema, operation) {
    if (operation.operation === 'query') {
        const queryType = schema.getQueryType();
        if (!queryType) {
            throw new GraphQLError('Schema does not define the required query root type.', operation);
        }
        return queryType;
    }
    if (operation.operation === 'mutation') {
        const mutationType = schema.getMutationType();
        if (!mutationType) {
            throw new GraphQLError('Schema is not configured for mutations.', operation);
        }
        return mutationType;
    }
    if (operation.operation === 'subscription') {
        const subscriptionType = schema.getSubscriptionType();
        if (!subscriptionType) {
            throw new GraphQLError('Schema is not configured for subscriptions.', operation);
        }
        return subscriptionType;
    }
    throw new GraphQLError('Can only have query, mutation and subscription operations.', operation);
}
function printPathArray(path) {
    return path.map((key)=>typeof key === 'number' ? '[' + key.toString() + ']' : '.' + key
    ).join('');
}
function valueFromAST(valueNode, type, variables) {
    if (!valueNode) {
        return;
    }
    if (valueNode.kind === Kind.VARIABLE) {
        const variableName = valueNode.name.value;
        if (variables == null || variables[variableName] === undefined) {
            return;
        }
        const variableValue = variables[variableName];
        if (variableValue === null && isNonNullType(type)) {
            return;
        }
        return variableValue;
    }
    if (isNonNullType(type)) {
        if (valueNode.kind === Kind.NULL) {
            return;
        }
        return valueFromAST(valueNode, type.ofType, variables);
    }
    if (valueNode.kind === Kind.NULL) {
        return null;
    }
    if (isListType(type)) {
        const itemType = type.ofType;
        if (valueNode.kind === Kind.LIST) {
            const coercedValues = [];
            for (const itemNode of valueNode.values){
                if (isMissingVariable(itemNode, variables)) {
                    if (isNonNullType(itemType)) {
                        return;
                    }
                    coercedValues.push(null);
                } else {
                    const itemValue = valueFromAST(itemNode, itemType, variables);
                    if (itemValue === undefined) {
                        return;
                    }
                    coercedValues.push(itemValue);
                }
            }
            return coercedValues;
        }
        const coercedValue = valueFromAST(valueNode, itemType, variables);
        if (coercedValue === undefined) {
            return;
        }
        return [
            coercedValue
        ];
    }
    if (isInputObjectType(type)) {
        if (valueNode.kind !== Kind.OBJECT) {
            return;
        }
        const coercedObj = Object.create(null);
        const fieldNodes = keyMap(valueNode.fields, (field)=>field.name.value
        );
        for (const field1 of objectValues(type.getFields())){
            const fieldNode = fieldNodes[field1.name];
            if (!fieldNode || isMissingVariable(fieldNode.value, variables)) {
                if (field1.defaultValue !== undefined) {
                    coercedObj[field1.name] = field1.defaultValue;
                } else if (isNonNullType(field1.type)) {
                    return;
                }
                continue;
            }
            const fieldValue = valueFromAST(fieldNode.value, field1.type, variables);
            if (fieldValue === undefined) {
                return;
            }
            coercedObj[field1.name] = fieldValue;
        }
        return coercedObj;
    }
    if (isLeafType(type)) {
        let result;
        try {
            result = type.parseLiteral(valueNode, variables);
        } catch (_error) {
            return;
        }
        if (result === undefined) {
            return;
        }
        return result;
    }
    invariant(false, 'Unexpected input type: ' + inspect(type));
}
function isMissingVariable(valueNode, variables) {
    return valueNode.kind === Kind.VARIABLE && (variables == null || variables[valueNode.name.value] === undefined);
}
function coerceInputValue(inputValue, type, onError = defaultOnError) {
    return coerceInputValueImpl(inputValue, type, onError);
}
function defaultOnError(path, invalidValue, error) {
    let errorPrefix = 'Invalid value ' + inspect(invalidValue);
    if (path.length > 0) {
        errorPrefix += ` at "value${printPathArray(path)}"`;
    }
    error.message = errorPrefix + ': ' + error.message;
    throw error;
}
function coerceInputValueImpl(inputValue, type, onError, path) {
    if (isNonNullType(type)) {
        if (inputValue != null) {
            return coerceInputValueImpl(inputValue, type.ofType, onError, path);
        }
        onError(pathToArray(path), inputValue, new GraphQLError(`Expected non-nullable type "${inspect(type)}" not to be null.`));
        return;
    }
    if (inputValue == null) {
        return null;
    }
    if (isListType(type)) {
        const itemType = type.ofType;
        if (isCollection(inputValue)) {
            return arrayFrom(inputValue, (itemValue, index)=>{
                const itemPath = addPath(path, index);
                return coerceInputValueImpl(itemValue, itemType, onError, itemPath);
            });
        }
        return [
            coerceInputValueImpl(inputValue, itemType, onError, path)
        ];
    }
    if (isInputObjectType(type)) {
        if (!isObjectLike(inputValue)) {
            onError(pathToArray(path), inputValue, new GraphQLError(`Expected type "${type.name}" to be an object.`));
            return;
        }
        const coercedValue = {};
        const fieldDefs = type.getFields();
        for (const field of objectValues(fieldDefs)){
            const fieldValue = inputValue[field.name];
            if (fieldValue === undefined) {
                if (field.defaultValue !== undefined) {
                    coercedValue[field.name] = field.defaultValue;
                } else if (isNonNullType(field.type)) {
                    const typeStr = inspect(field.type);
                    onError(pathToArray(path), inputValue, new GraphQLError(`Field "${field.name}" of required type "${typeStr}" was not provided.`));
                }
                continue;
            }
            coercedValue[field.name] = coerceInputValueImpl(fieldValue, field.type, onError, addPath(path, field.name));
        }
        for (const fieldName of Object.keys(inputValue)){
            if (!fieldDefs[fieldName]) {
                const suggestions = suggestionList(fieldName, Object.keys(type.getFields()));
                onError(pathToArray(path), inputValue, new GraphQLError(`Field "${fieldName}" is not defined by type "${type.name}".` + didYouMean(suggestions)));
            }
        }
        return coercedValue;
    }
    if (isLeafType(type)) {
        let parseResult;
        try {
            parseResult = type.parseValue(inputValue);
        } catch (error) {
            if (error instanceof GraphQLError) {
                onError(pathToArray(path), inputValue, error);
            } else {
                onError(pathToArray(path), inputValue, new GraphQLError(`Expected type "${type.name}". ` + error.message, undefined, undefined, undefined, undefined, error));
            }
            return;
        }
        if (parseResult === undefined) {
            onError(pathToArray(path), inputValue, new GraphQLError(`Expected type "${type.name}".`));
        }
        return parseResult;
    }
    invariant(false, 'Unexpected input type: ' + inspect(type));
}
function getVariableValues(schema, varDefNodes, inputs, options) {
    const errors = [];
    const maxErrors = options?.maxErrors;
    try {
        const coerced = coerceVariableValues(schema, varDefNodes, inputs, (error)=>{
            if (maxErrors != null && errors.length >= maxErrors) {
                throw new GraphQLError('Too many errors processing variables, error limit reached. Execution aborted.');
            }
            errors.push(error);
        });
        if (errors.length === 0) {
            return {
                coerced
            };
        }
    } catch (error) {
        errors.push(error);
    }
    return {
        errors
    };
}
function coerceVariableValues(schema, varDefNodes, inputs, onError) {
    const coercedValues = {};
    for (const varDefNode of varDefNodes){
        const varName = varDefNode.variable.name.value;
        const varType = typeFromAST(schema, varDefNode.type);
        if (!isInputType(varType)) {
            const varTypeStr = print(varDefNode.type);
            onError(new GraphQLError(`Variable "$${varName}" expected value of type "${varTypeStr}" which cannot be used as an input type.`, varDefNode.type));
            continue;
        }
        if (!hasOwnProperty(inputs, varName)) {
            if (varDefNode.defaultValue) {
                coercedValues[varName] = valueFromAST(varDefNode.defaultValue, varType);
            } else if (isNonNullType(varType)) {
                const varTypeStr = inspect(varType);
                onError(new GraphQLError(`Variable "$${varName}" of required type "${varTypeStr}" was not provided.`, varDefNode));
            }
            continue;
        }
        const value = inputs[varName];
        if (value === null && isNonNullType(varType)) {
            const varTypeStr = inspect(varType);
            onError(new GraphQLError(`Variable "$${varName}" of non-null type "${varTypeStr}" must not be null.`, varDefNode));
            continue;
        }
        coercedValues[varName] = coerceInputValue(value, varType, (path, invalidValue, error)=>{
            let prefix = `Variable "$${varName}" got invalid value ` + inspect(invalidValue);
            if (path.length > 0) {
                prefix += ` at "${varName}${printPathArray(path)}"`;
            }
            onError(new GraphQLError(prefix + '; ' + error.message, varDefNode, undefined, undefined, undefined, error.originalError));
        });
    }
    return coercedValues;
}
function getArgumentValues(def, node, variableValues) {
    const coercedValues = {};
    const argumentNodes = node.arguments ?? [];
    const argNodeMap = keyMap(argumentNodes, (arg)=>arg.name.value
    );
    for (const argDef of def.args){
        const name = argDef.name;
        const argType = argDef.type;
        const argumentNode = argNodeMap[name];
        if (!argumentNode) {
            if (argDef.defaultValue !== undefined) {
                coercedValues[name] = argDef.defaultValue;
            } else if (isNonNullType(argType)) {
                throw new GraphQLError(`Argument "${name}" of required type "${inspect(argType)}" ` + 'was not provided.', node);
            }
            continue;
        }
        const valueNode = argumentNode.value;
        let isNull = valueNode.kind === Kind.NULL;
        if (valueNode.kind === Kind.VARIABLE) {
            const variableName = valueNode.name.value;
            if (variableValues == null || !hasOwnProperty(variableValues, variableName)) {
                if (argDef.defaultValue !== undefined) {
                    coercedValues[name] = argDef.defaultValue;
                } else if (isNonNullType(argType)) {
                    throw new GraphQLError(`Argument "${name}" of required type "${inspect(argType)}" ` + `was provided the variable "$${variableName}" which was not provided a runtime value.`, valueNode);
                }
                continue;
            }
            isNull = variableValues[variableName] == null;
        }
        if (isNull && isNonNullType(argType)) {
            throw new GraphQLError(`Argument "${name}" of non-null type "${inspect(argType)}" ` + 'must not be null.', valueNode);
        }
        const coercedValue = valueFromAST(valueNode, argType, variableValues);
        if (coercedValue === undefined) {
            throw new GraphQLError(`Argument "${name}" has invalid value ${print(valueNode)}.`, valueNode);
        }
        coercedValues[name] = coercedValue;
    }
    return coercedValues;
}
function getDirectiveValues(directiveDef, node, variableValues) {
    const directiveNode = node.directives && find(node.directives, (directive)=>directive.name.value === directiveDef.name
    );
    if (directiveNode) {
        return getArgumentValues(directiveDef, directiveNode, variableValues);
    }
}
function hasOwnProperty(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}
function execute(argsOrSchema, document, rootValue, contextValue, variableValues, operationName, fieldResolver, typeResolver) {
    return arguments.length === 1 ? executeImpl(argsOrSchema) : executeImpl({
        schema: argsOrSchema,
        document,
        rootValue,
        contextValue,
        variableValues,
        operationName,
        fieldResolver,
        typeResolver
    });
}
function executeImpl(args) {
    const { schema , document , rootValue , contextValue , variableValues , operationName , fieldResolver , typeResolver  } = args;
    assertValidExecutionArguments(schema, document, variableValues);
    const exeContext = buildExecutionContext(schema, document, rootValue, contextValue, variableValues, operationName, fieldResolver, typeResolver);
    if (Array.isArray(exeContext)) {
        return {
            errors: exeContext
        };
    }
    const data = executeOperation(exeContext, exeContext.operation, rootValue);
    return buildResponse(exeContext, data);
}
function buildResponse(exeContext, data) {
    if (isPromise(data)) {
        return data.then((resolved)=>buildResponse(exeContext, resolved)
        );
    }
    return exeContext.errors.length === 0 ? {
        data
    } : {
        errors: exeContext.errors,
        data
    };
}
function assertValidExecutionArguments(schema, document, rawVariableValues) {
    devAssert(document, 'Must provide document.');
    assertValidSchema(schema);
    devAssert(rawVariableValues == null || isObjectLike(rawVariableValues), 'Variables must be provided as an Object where each property is a variable value. Perhaps look to see if an unparsed JSON string was provided.');
}
function buildExecutionContext(schema, document, rootValue, contextValue, rawVariableValues, operationName, fieldResolver, typeResolver) {
    let operation;
    const fragments = Object.create(null);
    for (const definition of document.definitions){
        switch(definition.kind){
            case Kind.OPERATION_DEFINITION:
                if (operationName == null) {
                    if (operation !== undefined) {
                        return [
                            new GraphQLError('Must provide operation name if query contains multiple operations.')
                        ];
                    }
                    operation = definition;
                } else if (definition.name?.value === operationName) {
                    operation = definition;
                }
                break;
            case Kind.FRAGMENT_DEFINITION:
                fragments[definition.name.value] = definition;
                break;
        }
    }
    if (!operation) {
        if (operationName != null) {
            return [
                new GraphQLError(`Unknown operation named "${operationName}".`)
            ];
        }
        return [
            new GraphQLError('Must provide an operation.')
        ];
    }
    const variableDefinitions = operation.variableDefinitions ?? [];
    const coercedVariableValues = getVariableValues(schema, variableDefinitions, rawVariableValues ?? {}, {
        maxErrors: 50
    });
    if (coercedVariableValues.errors) {
        return coercedVariableValues.errors;
    }
    return {
        schema,
        fragments,
        rootValue,
        contextValue,
        operation,
        variableValues: coercedVariableValues.coerced,
        fieldResolver: fieldResolver ?? defaultFieldResolver,
        typeResolver: typeResolver ?? defaultTypeResolver,
        errors: []
    };
}
function executeOperation(exeContext, operation, rootValue) {
    const type = getOperationRootType(exeContext.schema, operation);
    const fields = collectFields(exeContext, type, operation.selectionSet, Object.create(null), Object.create(null));
    const path = undefined;
    try {
        const result = operation.operation === 'mutation' ? executeFieldsSerially(exeContext, type, rootValue, path, fields) : executeFields(exeContext, type, rootValue, path, fields);
        if (isPromise(result)) {
            return result.then(undefined, (error)=>{
                exeContext.errors.push(error);
                return Promise.resolve(null);
            });
        }
        return result;
    } catch (error) {
        exeContext.errors.push(error);
        return null;
    }
}
function executeFieldsSerially(exeContext, parentType, sourceValue, path, fields) {
    return promiseReduce(Object.keys(fields), (results, responseName)=>{
        const fieldNodes = fields[responseName];
        const fieldPath = addPath(path, responseName);
        const result = resolveField(exeContext, parentType, sourceValue, fieldNodes, fieldPath);
        if (result === undefined) {
            return results;
        }
        if (isPromise(result)) {
            return result.then((resolvedResult)=>{
                results[responseName] = resolvedResult;
                return results;
            });
        }
        results[responseName] = result;
        return results;
    }, Object.create(null));
}
function executeFields(exeContext, parentType, sourceValue, path, fields) {
    const results = Object.create(null);
    let containsPromise = false;
    for (const responseName of Object.keys(fields)){
        const fieldNodes = fields[responseName];
        const fieldPath = addPath(path, responseName);
        const result = resolveField(exeContext, parentType, sourceValue, fieldNodes, fieldPath);
        if (result !== undefined) {
            results[responseName] = result;
            if (!containsPromise && isPromise(result)) {
                containsPromise = true;
            }
        }
    }
    if (!containsPromise) {
        return results;
    }
    return promiseForObject(results);
}
function collectFields(exeContext, runtimeType, selectionSet, fields, visitedFragmentNames) {
    for (const selection of selectionSet.selections){
        switch(selection.kind){
            case Kind.FIELD:
                {
                    if (!shouldIncludeNode(exeContext, selection)) {
                        continue;
                    }
                    const name = getFieldEntryKey(selection);
                    if (!fields[name]) {
                        fields[name] = [];
                    }
                    fields[name].push(selection);
                    break;
                }
            case Kind.INLINE_FRAGMENT:
                {
                    if (!shouldIncludeNode(exeContext, selection) || !doesFragmentConditionMatch(exeContext, selection, runtimeType)) {
                        continue;
                    }
                    collectFields(exeContext, runtimeType, selection.selectionSet, fields, visitedFragmentNames);
                    break;
                }
            case Kind.FRAGMENT_SPREAD:
                {
                    const fragName = selection.name.value;
                    if (visitedFragmentNames[fragName] || !shouldIncludeNode(exeContext, selection)) {
                        continue;
                    }
                    visitedFragmentNames[fragName] = true;
                    const fragment = exeContext.fragments[fragName];
                    if (!fragment || !doesFragmentConditionMatch(exeContext, fragment, runtimeType)) {
                        continue;
                    }
                    collectFields(exeContext, runtimeType, fragment.selectionSet, fields, visitedFragmentNames);
                    break;
                }
        }
    }
    return fields;
}
function shouldIncludeNode(exeContext, node) {
    const skip = getDirectiveValues(GraphQLSkipDirective, node, exeContext.variableValues);
    if (skip?.if === true) {
        return false;
    }
    const include = getDirectiveValues(GraphQLIncludeDirective, node, exeContext.variableValues);
    if (include?.if === false) {
        return false;
    }
    return true;
}
function doesFragmentConditionMatch(exeContext, fragment, type) {
    const typeConditionNode = fragment.typeCondition;
    if (!typeConditionNode) {
        return true;
    }
    const conditionalType = typeFromAST(exeContext.schema, typeConditionNode);
    if (conditionalType === type) {
        return true;
    }
    if (isAbstractType(conditionalType)) {
        return exeContext.schema.isSubType(conditionalType, type);
    }
    return false;
}
function getFieldEntryKey(node) {
    return node.alias ? node.alias.value : node.name.value;
}
function resolveField(exeContext, parentType, source, fieldNodes, path) {
    const fieldNode = fieldNodes[0];
    const fieldName = fieldNode.name.value;
    const fieldDef = getFieldDef1(exeContext.schema, parentType, fieldName);
    if (!fieldDef) {
        return;
    }
    const resolveFn = fieldDef.resolve ?? exeContext.fieldResolver;
    const info = buildResolveInfo(exeContext, fieldDef, fieldNodes, parentType, path);
    const result = resolveFieldValueOrError(exeContext, fieldDef, fieldNodes, resolveFn, source, info);
    return completeValueCatchingError(exeContext, fieldDef.type, fieldNodes, info, path, result);
}
function buildResolveInfo(exeContext, fieldDef, fieldNodes, parentType, path) {
    return {
        fieldName: fieldDef.name,
        fieldNodes,
        returnType: fieldDef.type,
        parentType,
        path,
        schema: exeContext.schema,
        fragments: exeContext.fragments,
        rootValue: exeContext.rootValue,
        operation: exeContext.operation,
        variableValues: exeContext.variableValues
    };
}
function resolveFieldValueOrError(exeContext, fieldDef, fieldNodes, resolveFn, source, info) {
    try {
        const args = getArgumentValues(fieldDef, fieldNodes[0], exeContext.variableValues);
        const contextValue = exeContext.contextValue;
        const result = resolveFn(source, args, contextValue, info);
        return isPromise(result) ? result.then(undefined, asErrorInstance) : result;
    } catch (error) {
        return asErrorInstance(error);
    }
}
function asErrorInstance(error) {
    if (error instanceof Error) {
        return error;
    }
    return new Error('Unexpected error value: ' + inspect(error));
}
function completeValueCatchingError(exeContext, returnType, fieldNodes, info, path, result) {
    try {
        let completed;
        if (isPromise(result)) {
            completed = result.then((resolved)=>completeValue(exeContext, returnType, fieldNodes, info, path, resolved)
            );
        } else {
            completed = completeValue(exeContext, returnType, fieldNodes, info, path, result);
        }
        if (isPromise(completed)) {
            return completed.then(undefined, (error)=>handleFieldError(error, fieldNodes, path, returnType, exeContext)
            );
        }
        return completed;
    } catch (error) {
        return handleFieldError(error, fieldNodes, path, returnType, exeContext);
    }
}
function handleFieldError(rawError, fieldNodes, path, returnType, exeContext) {
    const error = locatedError(asErrorInstance(rawError), fieldNodes, pathToArray(path));
    if (isNonNullType(returnType)) {
        throw error;
    }
    exeContext.errors.push(error);
    return null;
}
function completeValue(exeContext, returnType, fieldNodes, info, path, result) {
    if (result instanceof Error) {
        throw result;
    }
    if (isNonNullType(returnType)) {
        const completed = completeValue(exeContext, returnType.ofType, fieldNodes, info, path, result);
        if (completed === null) {
            throw new Error(`Cannot return null for non-nullable field ${info.parentType.name}.${info.fieldName}.`);
        }
        return completed;
    }
    if (result == null) {
        return null;
    }
    if (isListType(returnType)) {
        return completeListValue(exeContext, returnType, fieldNodes, info, path, result);
    }
    if (isLeafType(returnType)) {
        return completeLeafValue(returnType, result);
    }
    if (isAbstractType(returnType)) {
        return completeAbstractValue(exeContext, returnType, fieldNodes, info, path, result);
    }
    if (isObjectType(returnType)) {
        return completeObjectValue(exeContext, returnType, fieldNodes, info, path, result);
    }
    invariant(false, 'Cannot complete value of unexpected output type: ' + inspect(returnType));
}
function completeListValue(exeContext, returnType, fieldNodes, info, path, result) {
    if (!isCollection(result)) {
        throw new GraphQLError(`Expected Iterable, but did not find one for field "${info.parentType.name}.${info.fieldName}".`);
    }
    const itemType = returnType.ofType;
    let containsPromise = false;
    const completedResults = arrayFrom(result, (item, index)=>{
        const fieldPath = addPath(path, index);
        const completedItem = completeValueCatchingError(exeContext, itemType, fieldNodes, info, fieldPath, item);
        if (!containsPromise && isPromise(completedItem)) {
            containsPromise = true;
        }
        return completedItem;
    });
    return containsPromise ? Promise.all(completedResults) : completedResults;
}
function completeLeafValue(returnType, result) {
    const serializedResult = returnType.serialize(result);
    if (serializedResult === undefined) {
        throw new Error(`Expected a value of type "${inspect(returnType)}" but ` + `received: ${inspect(result)}`);
    }
    return serializedResult;
}
function completeAbstractValue(exeContext, returnType, fieldNodes, info, path, result) {
    const resolveTypeFn = returnType.resolveType ?? exeContext.typeResolver;
    const contextValue = exeContext.contextValue;
    const runtimeType = resolveTypeFn(result, contextValue, info, returnType);
    if (isPromise(runtimeType)) {
        return runtimeType.then((resolvedRuntimeType)=>completeObjectValue(exeContext, ensureValidRuntimeType(resolvedRuntimeType, exeContext, returnType, fieldNodes, info, result), fieldNodes, info, path, result)
        );
    }
    return completeObjectValue(exeContext, ensureValidRuntimeType(runtimeType, exeContext, returnType, fieldNodes, info, result), fieldNodes, info, path, result);
}
function ensureValidRuntimeType(runtimeTypeOrName, exeContext, returnType, fieldNodes, info, result) {
    const runtimeType = typeof runtimeTypeOrName === 'string' ? exeContext.schema.getType(runtimeTypeOrName) : runtimeTypeOrName;
    if (!isObjectType(runtimeType)) {
        throw new GraphQLError(`Abstract type "${returnType.name}" must resolve to an Object type at runtime for field "${info.parentType.name}.${info.fieldName}" with ` + `value ${inspect(result)}, received "${inspect(runtimeType)}". ` + `Either the "${returnType.name}" type should provide a "resolveType" function or each possible type should provide an "isTypeOf" function.`, fieldNodes);
    }
    if (!exeContext.schema.isSubType(returnType, runtimeType)) {
        throw new GraphQLError(`Runtime Object type "${runtimeType.name}" is not a possible type for "${returnType.name}".`, fieldNodes);
    }
    return runtimeType;
}
function completeObjectValue(exeContext, returnType, fieldNodes, info, path, result) {
    if (returnType.isTypeOf) {
        const isTypeOf = returnType.isTypeOf(result, exeContext.contextValue, info);
        if (isPromise(isTypeOf)) {
            return isTypeOf.then((resolvedIsTypeOf)=>{
                if (!resolvedIsTypeOf) {
                    throw invalidReturnTypeError(returnType, result, fieldNodes);
                }
                return collectAndExecuteSubfields(exeContext, returnType, fieldNodes, path, result);
            });
        }
        if (!isTypeOf) {
            throw invalidReturnTypeError(returnType, result, fieldNodes);
        }
    }
    return collectAndExecuteSubfields(exeContext, returnType, fieldNodes, path, result);
}
function invalidReturnTypeError(returnType, result, fieldNodes) {
    return new GraphQLError(`Expected value of type "${returnType.name}" but got: ${inspect(result)}.`, fieldNodes);
}
function collectAndExecuteSubfields(exeContext, returnType, fieldNodes, path, result) {
    const subFieldNodes = collectSubfields(exeContext, returnType, fieldNodes);
    return executeFields(exeContext, returnType, result, path, subFieldNodes);
}
const collectSubfields = memoize3(_collectSubfields);
function _collectSubfields(exeContext, returnType, fieldNodes) {
    let subFieldNodes = Object.create(null);
    const visitedFragmentNames = Object.create(null);
    for (const node of fieldNodes){
        if (node.selectionSet) {
            subFieldNodes = collectFields(exeContext, returnType, node.selectionSet, subFieldNodes, visitedFragmentNames);
        }
    }
    return subFieldNodes;
}
const defaultTypeResolver = function(value, contextValue, info, abstractType) {
    if (isObjectLike(value) && typeof value.__typename === 'string') {
        return value.__typename;
    }
    const possibleTypes = info.schema.getPossibleTypes(abstractType);
    const promisedIsTypeOfResults = [];
    for(let i1 = 0; i1 < possibleTypes.length; i1++){
        const type = possibleTypes[i1];
        if (type.isTypeOf) {
            const isTypeOfResult = type.isTypeOf(value, contextValue, info);
            if (isPromise(isTypeOfResult)) {
                promisedIsTypeOfResults[i1] = isTypeOfResult;
            } else if (isTypeOfResult) {
                return type;
            }
        }
    }
    if (promisedIsTypeOfResults.length) {
        return Promise.all(promisedIsTypeOfResults).then((isTypeOfResults)=>{
            for(let i = 0; i < isTypeOfResults.length; i++){
                if (isTypeOfResults[i]) {
                    return possibleTypes[i];
                }
            }
        });
    }
};
const defaultFieldResolver = function(source, args, contextValue, info) {
    if (isObjectLike(source) || typeof source === 'function') {
        const property = source[info.fieldName];
        if (typeof property === 'function') {
            return source[info.fieldName](args, contextValue, info);
        }
        return property;
    }
};
function getFieldDef1(schema, parentType, fieldName) {
    if (fieldName === SchemaMetaFieldDef.name && schema.getQueryType() === parentType) {
        return SchemaMetaFieldDef;
    } else if (fieldName === TypeMetaFieldDef.name && schema.getQueryType() === parentType) {
        return TypeMetaFieldDef;
    } else if (fieldName === TypeNameMetaFieldDef.name) {
        return TypeNameMetaFieldDef;
    }
    return parentType.getFields()[fieldName];
}
function graphql(argsOrSchema, source, rootValue, contextValue, variableValues, operationName, fieldResolver, typeResolver) {
    return new Promise((resolve)=>resolve(arguments.length === 1 ? graphqlImpl(argsOrSchema) : graphqlImpl({
            schema: argsOrSchema,
            source,
            rootValue,
            contextValue,
            variableValues,
            operationName,
            fieldResolver,
            typeResolver
        }))
    );
}
function graphqlImpl(args) {
    const { schema , source , rootValue , contextValue , variableValues , operationName , fieldResolver , typeResolver  } = args;
    const schemaValidationErrors = validateSchema(schema);
    if (schemaValidationErrors.length > 0) {
        return {
            errors: schemaValidationErrors
        };
    }
    let document;
    try {
        document = parse1(source);
    } catch (syntaxError1) {
        return {
            errors: [
                syntaxError1
            ]
        };
    }
    const validationErrors = validate(schema, document);
    if (validationErrors.length > 0) {
        return {
            errors: validationErrors
        };
    }
    return execute({
        schema,
        document,
        rootValue,
        contextValue,
        variableValues,
        operationName,
        fieldResolver,
        typeResolver
    });
}
function extendSchema(schema, documentAST, options) {
    assertSchema(schema);
    devAssert(documentAST != null && documentAST.kind === Kind.DOCUMENT, 'Must provide valid Document AST.');
    if (options?.assumeValid !== true && options?.assumeValidSDL !== true) {
        assertValidSDLExtension(documentAST, schema);
    }
    const schemaConfig = schema.toConfig();
    const extendedConfig = extendSchemaImpl(schemaConfig, documentAST, options);
    return schemaConfig === extendedConfig ? schema : new GraphQLSchema(extendedConfig);
}
function extendSchemaImpl(schemaConfig, documentAST, options) {
    const typeDefs1 = [];
    const typeExtensionsMap = Object.create(null);
    const directiveDefs = [];
    let schemaDef;
    const schemaExtensions = [];
    for (const def of documentAST.definitions){
        if (def.kind === Kind.SCHEMA_DEFINITION) {
            schemaDef = def;
        } else if (def.kind === Kind.SCHEMA_EXTENSION) {
            schemaExtensions.push(def);
        } else if (isTypeDefinitionNode(def)) {
            typeDefs1.push(def);
        } else if (isTypeExtensionNode(def)) {
            const extendedTypeName = def.name.value;
            const existingTypeExtensions = typeExtensionsMap[extendedTypeName];
            typeExtensionsMap[extendedTypeName] = existingTypeExtensions ? existingTypeExtensions.concat([
                def
            ]) : [
                def
            ];
        } else if (def.kind === Kind.DIRECTIVE_DEFINITION) {
            directiveDefs.push(def);
        }
    }
    if (Object.keys(typeExtensionsMap).length === 0 && typeDefs1.length === 0 && directiveDefs.length === 0 && schemaExtensions.length === 0 && schemaDef == null) {
        return schemaConfig;
    }
    const typeMap = Object.create(null);
    for (const existingType of schemaConfig.types){
        typeMap[existingType.name] = extendNamedType(existingType);
    }
    for (const typeNode of typeDefs1){
        const name = typeNode.name.value;
        typeMap[name] = stdTypeMap[name] ?? buildType(typeNode);
    }
    const operationTypes = {
        query: schemaConfig.query && replaceNamedType(schemaConfig.query),
        mutation: schemaConfig.mutation && replaceNamedType(schemaConfig.mutation),
        subscription: schemaConfig.subscription && replaceNamedType(schemaConfig.subscription),
        ...schemaDef && getOperationTypes([
            schemaDef
        ]),
        ...getOperationTypes(schemaExtensions)
    };
    return {
        description: schemaDef?.description?.value,
        ...operationTypes,
        types: objectValues(typeMap),
        directives: [
            ...schemaConfig.directives.map(replaceDirective),
            ...directiveDefs.map(buildDirective)
        ],
        extensions: undefined,
        astNode: schemaDef ?? schemaConfig.astNode,
        extensionASTNodes: schemaConfig.extensionASTNodes.concat(schemaExtensions),
        assumeValid: options?.assumeValid ?? false
    };
    function replaceType(type) {
        if (isListType(type)) {
            return new GraphQLList(replaceType(type.ofType));
        } else if (isNonNullType(type)) {
            return new GraphQLNonNull(replaceType(type.ofType));
        }
        return replaceNamedType(type);
    }
    function replaceNamedType(type) {
        return typeMap[type.name];
    }
    function replaceDirective(directive) {
        const config = directive.toConfig();
        return new GraphQLDirective({
            ...config,
            args: mapValue(config.args, extendArg)
        });
    }
    function extendNamedType(type) {
        if (isIntrospectionType(type) || isSpecifiedScalarType(type)) {
            return type;
        }
        if (isScalarType(type)) {
            return extendScalarType(type);
        }
        if (isObjectType(type)) {
            return extendObjectType(type);
        }
        if (isInterfaceType(type)) {
            return extendInterfaceType(type);
        }
        if (isUnionType(type)) {
            return extendUnionType(type);
        }
        if (isEnumType(type)) {
            return extendEnumType(type);
        }
        if (isInputObjectType(type)) {
            return extendInputObjectType(type);
        }
        invariant(false, 'Unexpected type: ' + inspect(type));
    }
    function extendInputObjectType(type) {
        const config = type.toConfig();
        const extensions = typeExtensionsMap[config.name] ?? [];
        return new GraphQLInputObjectType({
            ...config,
            fields: ()=>({
                    ...mapValue(config.fields, (field)=>({
                            ...field,
                            type: replaceType(field.type)
                        })
                    ),
                    ...buildInputFieldMap(extensions)
                })
            ,
            extensionASTNodes: config.extensionASTNodes.concat(extensions)
        });
    }
    function extendEnumType(type) {
        const config = type.toConfig();
        const extensions = typeExtensionsMap[type.name] ?? [];
        return new GraphQLEnumType({
            ...config,
            values: {
                ...config.values,
                ...buildEnumValueMap(extensions)
            },
            extensionASTNodes: config.extensionASTNodes.concat(extensions)
        });
    }
    function extendScalarType(type) {
        const config = type.toConfig();
        const extensions = typeExtensionsMap[config.name] ?? [];
        return new GraphQLScalarType({
            ...config,
            extensionASTNodes: config.extensionASTNodes.concat(extensions)
        });
    }
    function extendObjectType(type) {
        const config = type.toConfig();
        const extensions = typeExtensionsMap[config.name] ?? [];
        return new GraphQLObjectType({
            ...config,
            interfaces: ()=>[
                    ...type.getInterfaces().map(replaceNamedType),
                    ...buildInterfaces(extensions)
                ]
            ,
            fields: ()=>({
                    ...mapValue(config.fields, extendField),
                    ...buildFieldMap(extensions)
                })
            ,
            extensionASTNodes: config.extensionASTNodes.concat(extensions)
        });
    }
    function extendInterfaceType(type) {
        const config = type.toConfig();
        const extensions = typeExtensionsMap[config.name] ?? [];
        return new GraphQLInterfaceType({
            ...config,
            interfaces: ()=>[
                    ...type.getInterfaces().map(replaceNamedType),
                    ...buildInterfaces(extensions)
                ]
            ,
            fields: ()=>({
                    ...mapValue(config.fields, extendField),
                    ...buildFieldMap(extensions)
                })
            ,
            extensionASTNodes: config.extensionASTNodes.concat(extensions)
        });
    }
    function extendUnionType(type) {
        const config = type.toConfig();
        const extensions = typeExtensionsMap[config.name] ?? [];
        return new GraphQLUnionType({
            ...config,
            types: ()=>[
                    ...type.getTypes().map(replaceNamedType),
                    ...buildUnionTypes(extensions)
                ]
            ,
            extensionASTNodes: config.extensionASTNodes.concat(extensions)
        });
    }
    function extendField(field) {
        return {
            ...field,
            type: replaceType(field.type),
            args: mapValue(field.args, extendArg)
        };
    }
    function extendArg(arg) {
        return {
            ...arg,
            type: replaceType(arg.type)
        };
    }
    function getOperationTypes(nodes) {
        const opTypes = {};
        for (const node of nodes){
            const operationTypesNodes = node.operationTypes ?? [];
            for (const operationType of operationTypesNodes){
                opTypes[operationType.operation] = getNamedType1(operationType.type);
            }
        }
        return opTypes;
    }
    function getNamedType1(node) {
        const name = node.name.value;
        const type = stdTypeMap[name] ?? typeMap[name];
        if (type === undefined) {
            throw new Error(`Unknown type: "${name}".`);
        }
        return type;
    }
    function getWrappedType(node) {
        if (node.kind === Kind.LIST_TYPE) {
            return new GraphQLList(getWrappedType(node.type));
        }
        if (node.kind === Kind.NON_NULL_TYPE) {
            return new GraphQLNonNull(getWrappedType(node.type));
        }
        return getNamedType1(node);
    }
    function buildDirective(node) {
        const locations = node.locations.map(({ value  })=>value
        );
        return new GraphQLDirective({
            name: node.name.value,
            description: getDescription(node, options),
            locations,
            isRepeatable: node.repeatable,
            args: buildArgumentMap(node.arguments),
            astNode: node
        });
    }
    function buildFieldMap(nodes) {
        const fieldConfigMap = Object.create(null);
        for (const node of nodes){
            const nodeFields = node.fields ?? [];
            for (const field of nodeFields){
                fieldConfigMap[field.name.value] = {
                    type: getWrappedType(field.type),
                    description: getDescription(field, options),
                    args: buildArgumentMap(field.arguments),
                    deprecationReason: getDeprecationReason(field),
                    astNode: field
                };
            }
        }
        return fieldConfigMap;
    }
    function buildArgumentMap(args) {
        const argsNodes = args ?? [];
        const argConfigMap = Object.create(null);
        for (const arg of argsNodes){
            const type = getWrappedType(arg.type);
            argConfigMap[arg.name.value] = {
                type,
                description: getDescription(arg, options),
                defaultValue: valueFromAST(arg.defaultValue, type),
                astNode: arg
            };
        }
        return argConfigMap;
    }
    function buildInputFieldMap(nodes) {
        const inputFieldMap = Object.create(null);
        for (const node of nodes){
            const fieldsNodes = node.fields ?? [];
            for (const field of fieldsNodes){
                const type = getWrappedType(field.type);
                inputFieldMap[field.name.value] = {
                    type,
                    description: getDescription(field, options),
                    defaultValue: valueFromAST(field.defaultValue, type),
                    astNode: field
                };
            }
        }
        return inputFieldMap;
    }
    function buildEnumValueMap(nodes) {
        const enumValueMap = Object.create(null);
        for (const node of nodes){
            const valuesNodes = node.values ?? [];
            for (const value of valuesNodes){
                enumValueMap[value.name.value] = {
                    description: getDescription(value, options),
                    deprecationReason: getDeprecationReason(value),
                    astNode: value
                };
            }
        }
        return enumValueMap;
    }
    function buildInterfaces(nodes) {
        const interfaces = [];
        for (const node of nodes){
            const interfacesNodes = node.interfaces ?? [];
            for (const type of interfacesNodes){
                interfaces.push(getNamedType1(type));
            }
        }
        return interfaces;
    }
    function buildUnionTypes(nodes) {
        const types = [];
        for (const node of nodes){
            const typeNodes = node.types ?? [];
            for (const type of typeNodes){
                types.push(getNamedType1(type));
            }
        }
        return types;
    }
    function buildType(astNode) {
        const name = astNode.name.value;
        const description = getDescription(astNode, options);
        const extensionNodes = typeExtensionsMap[name] ?? [];
        switch(astNode.kind){
            case Kind.OBJECT_TYPE_DEFINITION:
                {
                    const extensionASTNodes = extensionNodes;
                    const allNodes = [
                        astNode,
                        ...extensionASTNodes
                    ];
                    return new GraphQLObjectType({
                        name,
                        description,
                        interfaces: ()=>buildInterfaces(allNodes)
                        ,
                        fields: ()=>buildFieldMap(allNodes)
                        ,
                        astNode,
                        extensionASTNodes
                    });
                }
            case Kind.INTERFACE_TYPE_DEFINITION:
                {
                    const extensionASTNodes = extensionNodes;
                    const allNodes = [
                        astNode,
                        ...extensionASTNodes
                    ];
                    return new GraphQLInterfaceType({
                        name,
                        description,
                        interfaces: ()=>buildInterfaces(allNodes)
                        ,
                        fields: ()=>buildFieldMap(allNodes)
                        ,
                        astNode,
                        extensionASTNodes
                    });
                }
            case Kind.ENUM_TYPE_DEFINITION:
                {
                    const extensionASTNodes = extensionNodes;
                    const allNodes = [
                        astNode,
                        ...extensionASTNodes
                    ];
                    return new GraphQLEnumType({
                        name,
                        description,
                        values: buildEnumValueMap(allNodes),
                        astNode,
                        extensionASTNodes
                    });
                }
            case Kind.UNION_TYPE_DEFINITION:
                {
                    const extensionASTNodes = extensionNodes;
                    const allNodes = [
                        astNode,
                        ...extensionASTNodes
                    ];
                    return new GraphQLUnionType({
                        name,
                        description,
                        types: ()=>buildUnionTypes(allNodes)
                        ,
                        astNode,
                        extensionASTNodes
                    });
                }
            case Kind.SCALAR_TYPE_DEFINITION:
                {
                    const extensionASTNodes = extensionNodes;
                    return new GraphQLScalarType({
                        name,
                        description,
                        astNode,
                        extensionASTNodes
                    });
                }
            case Kind.INPUT_OBJECT_TYPE_DEFINITION:
                {
                    const extensionASTNodes = extensionNodes;
                    const allNodes = [
                        astNode,
                        ...extensionASTNodes
                    ];
                    return new GraphQLInputObjectType({
                        name,
                        description,
                        fields: ()=>buildInputFieldMap(allNodes)
                        ,
                        astNode,
                        extensionASTNodes
                    });
                }
        }
        invariant(false, 'Unexpected type definition node: ' + inspect(astNode));
    }
}
const stdTypeMap = keyMap(specifiedScalarTypes.concat(introspectionTypes), (type)=>type.name
);
function getDeprecationReason(node) {
    const deprecated = getDirectiveValues(GraphQLDeprecatedDirective, node);
    return deprecated?.reason;
}
function getDescription(node, options) {
    if (node.description) {
        return node.description.value;
    }
    if (options?.commentDescriptions === true) {
        const rawValue = getLeadingCommentBlock(node);
        if (rawValue !== undefined) {
            return dedentBlockStringValue('\n' + rawValue);
        }
    }
}
function getLeadingCommentBlock(node) {
    const loc = node.loc;
    if (!loc) {
        return;
    }
    const comments = [];
    let token = loc.startToken.prev;
    while(token != null && token.kind === TokenKind.COMMENT && token.next && token.prev && token.line + 1 === token.next.line && token.line !== token.prev.line){
        const value = String(token.value);
        comments.push(value);
        token = token.prev;
    }
    return comments.length > 0 ? comments.reverse().join('\n') : undefined;
}
function buildASTSchema(documentAST, options) {
    devAssert(documentAST != null && documentAST.kind === Kind.DOCUMENT, 'Must provide valid Document AST.');
    if (options?.assumeValid !== true && options?.assumeValidSDL !== true) {
        assertValidSDL(documentAST);
    }
    const config = extendSchemaImpl(emptySchemaConfig, documentAST, options);
    if (config.astNode == null) {
        for (const type of config.types){
            switch(type.name){
                case 'Query':
                    config.query = type;
                    break;
                case 'Mutation':
                    config.mutation = type;
                    break;
                case 'Subscription':
                    config.subscription = type;
                    break;
            }
        }
    }
    const { directives  } = config;
    if (!directives.some((directive)=>directive.name === 'skip'
    )) {
        directives.push(GraphQLSkipDirective);
    }
    if (!directives.some((directive)=>directive.name === 'include'
    )) {
        directives.push(GraphQLIncludeDirective);
    }
    if (!directives.some((directive)=>directive.name === 'deprecated'
    )) {
        directives.push(GraphQLDeprecatedDirective);
    }
    return new GraphQLSchema(config);
}
const emptySchemaConfig = new GraphQLSchema({
    directives: []
}).toConfig();
Object.freeze({
    TYPE_REMOVED: 'TYPE_REMOVED',
    TYPE_CHANGED_KIND: 'TYPE_CHANGED_KIND',
    TYPE_REMOVED_FROM_UNION: 'TYPE_REMOVED_FROM_UNION',
    VALUE_REMOVED_FROM_ENUM: 'VALUE_REMOVED_FROM_ENUM',
    REQUIRED_INPUT_FIELD_ADDED: 'REQUIRED_INPUT_FIELD_ADDED',
    IMPLEMENTED_INTERFACE_REMOVED: 'IMPLEMENTED_INTERFACE_REMOVED',
    FIELD_REMOVED: 'FIELD_REMOVED',
    FIELD_CHANGED_KIND: 'FIELD_CHANGED_KIND',
    REQUIRED_ARG_ADDED: 'REQUIRED_ARG_ADDED',
    ARG_REMOVED: 'ARG_REMOVED',
    ARG_CHANGED_KIND: 'ARG_CHANGED_KIND',
    DIRECTIVE_REMOVED: 'DIRECTIVE_REMOVED',
    DIRECTIVE_ARG_REMOVED: 'DIRECTIVE_ARG_REMOVED',
    REQUIRED_DIRECTIVE_ARG_ADDED: 'REQUIRED_DIRECTIVE_ARG_ADDED',
    DIRECTIVE_REPEATABLE_REMOVED: 'DIRECTIVE_REPEATABLE_REMOVED',
    DIRECTIVE_LOCATION_REMOVED: 'DIRECTIVE_LOCATION_REMOVED'
});
Object.freeze({
    VALUE_ADDED_TO_ENUM: 'VALUE_ADDED_TO_ENUM',
    TYPE_ADDED_TO_UNION: 'TYPE_ADDED_TO_UNION',
    OPTIONAL_INPUT_FIELD_ADDED: 'OPTIONAL_INPUT_FIELD_ADDED',
    OPTIONAL_ARG_ADDED: 'OPTIONAL_ARG_ADDED',
    IMPLEMENTED_INTERFACE_ADDED: 'IMPLEMENTED_INTERFACE_ADDED',
    ARG_DEFAULT_VALUE_CHANGE: 'ARG_DEFAULT_VALUE_CHANGE'
});
async function runHttpQuery(params, options, context) {
    const contextValue = options.context && context?.request ? await options.context?.(context?.request) : context;
    const source = params.query || params.mutation;
    return await graphql({
        source,
        ...options,
        contextValue,
        variableValues: params.variables,
        operationName: params.operationName
    });
}
new TextDecoder();
function GraphQLHTTP({ playgroundOptions ={} , headers ={} , ...options }) {
    return async (request)=>{
        if (options.graphiql && request.method === 'GET') {
            if (request.headers.get('Accept')?.includes('text/html')) {
                const { renderPlaygroundPage  } = await import('./graphiql/render.ts');
                const playground = renderPlaygroundPage({
                    ...playgroundOptions,
                    endpoint: '/graphql'
                });
                return new Response(playground, {
                    headers: new Headers({
                        'Content-Type': 'text/html',
                        ...headers
                    })
                });
            } else {
                return new Response('"Accept" header value must include text/html', {
                    status: 400,
                    headers: new Headers(headers)
                });
            }
        } else {
            if (![
                'PUT',
                'POST',
                'PATCH'
            ].includes(request.method)) {
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: new Headers(headers)
                });
            } else {
                try {
                    const result = await runHttpQuery(await request.json(), options, {
                        request
                    });
                    return new Response(JSON.stringify(result, null, 2), {
                        status: 200,
                        headers: new Headers({
                            'Content-Type': 'application/json',
                            ...headers
                        })
                    });
                } catch (e) {
                    console.error(e);
                    return new Response('Malformed request body', {
                        status: 400,
                        headers: new Headers(headers)
                    });
                }
            }
        }
    };
}
function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}
function mergeDeep(target, ...sources) {
    const output = {
        ...target
    };
    sources.forEach((source)=>{
        if (isObject(target) && isObject(source)) {
            Object.keys(source).forEach((key)=>{
                if (isObject(source[key])) {
                    if (!(key in target)) {
                        Object.assign(output, {
                            [key]: source[key]
                        });
                    } else {
                        output[key] = mergeDeep(target[key], source[key]);
                    }
                } else {
                    Object.assign(output, {
                        [key]: source[key]
                    });
                }
            });
        }
    });
    return output;
}
var VisitSchemaKind;
(function(VisitSchemaKind1) {
    VisitSchemaKind1["TYPE"] = 'VisitSchemaKind.TYPE';
    VisitSchemaKind1["SCALAR_TYPE"] = 'VisitSchemaKind.SCALAR_TYPE';
    VisitSchemaKind1["ENUM_TYPE"] = 'VisitSchemaKind.ENUM_TYPE';
    VisitSchemaKind1["COMPOSITE_TYPE"] = 'VisitSchemaKind.COMPOSITE_TYPE';
    VisitSchemaKind1["OBJECT_TYPE"] = 'VisitSchemaKind.OBJECT_TYPE';
    VisitSchemaKind1["INPUT_OBJECT_TYPE"] = 'VisitSchemaKind.INPUT_OBJECT_TYPE';
    VisitSchemaKind1["ABSTRACT_TYPE"] = 'VisitSchemaKind.ABSTRACT_TYPE';
    VisitSchemaKind1["UNION_TYPE"] = 'VisitSchemaKind.UNION_TYPE';
    VisitSchemaKind1["INTERFACE_TYPE"] = 'VisitSchemaKind.INTERFACE_TYPE';
    VisitSchemaKind1["ROOT_OBJECT"] = 'VisitSchemaKind.ROOT_OBJECT';
    VisitSchemaKind1["QUERY"] = 'VisitSchemaKind.QUERY';
    VisitSchemaKind1["MUTATION"] = 'VisitSchemaKind.MUTATION';
    VisitSchemaKind1["SUBSCRIPTION"] = 'VisitSchemaKind.SUBSCRIPTION';
})(VisitSchemaKind || (VisitSchemaKind = {}));
var MapperKind;
(function(MapperKind1) {
    MapperKind1["TYPE"] = 'MapperKind.TYPE';
    MapperKind1["SCALAR_TYPE"] = 'MapperKind.SCALAR_TYPE';
    MapperKind1["ENUM_TYPE"] = 'MapperKind.ENUM_TYPE';
    MapperKind1["COMPOSITE_TYPE"] = 'MapperKind.COMPOSITE_TYPE';
    MapperKind1["OBJECT_TYPE"] = 'MapperKind.OBJECT_TYPE';
    MapperKind1["INPUT_OBJECT_TYPE"] = 'MapperKind.INPUT_OBJECT_TYPE';
    MapperKind1["ABSTRACT_TYPE"] = 'MapperKind.ABSTRACT_TYPE';
    MapperKind1["UNION_TYPE"] = 'MapperKind.UNION_TYPE';
    MapperKind1["INTERFACE_TYPE"] = 'MapperKind.INTERFACE_TYPE';
    MapperKind1["ROOT_OBJECT"] = 'MapperKind.ROOT_OBJECT';
    MapperKind1["QUERY"] = 'MapperKind.QUERY';
    MapperKind1["MUTATION"] = 'MapperKind.MUTATION';
    MapperKind1["SUBSCRIPTION"] = 'MapperKind.SUBSCRIPTION';
    MapperKind1["DIRECTIVE"] = 'MapperKind.DIRECTIVE';
    MapperKind1["FIELD"] = 'MapperKind.FIELD';
    MapperKind1["COMPOSITE_FIELD"] = 'MapperKind.COMPOSITE_FIELD';
    MapperKind1["OBJECT_FIELD"] = 'MapperKind.OBJECT_FIELD';
    MapperKind1["ROOT_FIELD"] = 'MapperKind.ROOT_FIELD';
    MapperKind1["QUERY_ROOT_FIELD"] = 'MapperKind.QUERY_ROOT_FIELD';
    MapperKind1["MUTATION_ROOT_FIELD"] = 'MapperKind.MUTATION_ROOT_FIELD';
    MapperKind1["SUBSCRIPTION_ROOT_FIELD"] = 'MapperKind.SUBSCRIPTION_ROOT_FIELD';
    MapperKind1["INTERFACE_FIELD"] = 'MapperKind.INTERFACE_FIELD';
    MapperKind1["INPUT_OBJECT_FIELD"] = 'MapperKind.INPUT_OBJECT_FIELD';
    MapperKind1["ARGUMENT"] = 'MapperKind.ARGUMENT';
    MapperKind1["ENUM_VALUE"] = 'MapperKind.ENUM_VALUE';
})(MapperKind || (MapperKind = {}));
class SchemaVisitor {
    schema;
    static implementsVisitorMethod(methodName) {
        if (!methodName.startsWith('visit')) {
            return false;
        }
        const method = this.prototype[methodName];
        if (typeof method !== 'function') {
            return false;
        }
        if (this.name === 'SchemaVisitor') {
            return true;
        }
        const stub = SchemaVisitor.prototype[methodName];
        if (method === stub) {
            return false;
        }
        return true;
    }
    visitSchema(_schema) {}
    visitScalar(_scalar) {}
    visitObject(_object) {}
    visitFieldDefinition(_field, _details) {}
    visitArgumentDefinition(_argument, _details) {}
    visitInterface(_iface) {}
    visitUnion(_union) {}
    visitEnum(_type) {}
    visitEnumValue(_value, _details) {}
    visitInputObject(_object) {}
    visitInputFieldDefinition(_field, _details) {}
}
function isNamedStub(type) {
    if (isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)) {
        const fields = type.getFields();
        const fieldNames = Object.keys(fields);
        return fieldNames.length === 1 && fields[fieldNames[0]].name === '__fake';
    }
    return false;
}
function getBuiltInForStub(type) {
    switch(type.name){
        case GraphQLInt.name:
            return GraphQLInt;
        case GraphQLFloat.name:
            return GraphQLFloat;
        case GraphQLString.name:
            return GraphQLString;
        case GraphQLBoolean.name:
            return GraphQLBoolean;
        case GraphQLID.name:
            return GraphQLID;
        default:
            return type;
    }
}
function rewireTypes(originalTypeMap, directives, options = {
    skipPruning: false
}) {
    const newTypeMap = Object.create(null);
    Object.keys(originalTypeMap).forEach((typeName)=>{
        const namedType = originalTypeMap[typeName];
        if (namedType == null || typeName.startsWith('__')) {
            return;
        }
        const newName = namedType.name;
        if (newName.startsWith('__')) {
            return;
        }
        if (newTypeMap[newName] != null) {
            throw new Error(`Duplicate schema type name ${newName}`);
        }
        newTypeMap[newName] = namedType;
    });
    Object.keys(newTypeMap).forEach((typeName)=>{
        newTypeMap[typeName] = rewireNamedType(newTypeMap[typeName]);
    });
    const newDirectives = directives.map((directive)=>rewireDirective(directive)
    );
    return options.skipPruning ? {
        typeMap: newTypeMap,
        directives: newDirectives
    } : pruneTypes(newTypeMap, newDirectives);
    function rewireDirective(directive) {
        const directiveConfig = directive.toConfig();
        directiveConfig.args = rewireArgs(directiveConfig.args);
        return new GraphQLDirective(directiveConfig);
    }
    function rewireArgs(args) {
        const rewiredArgs = {};
        Object.keys(args).forEach((argName)=>{
            const arg = args[argName];
            const rewiredArgType = rewireType(arg.type);
            if (rewiredArgType != null) {
                arg.type = rewiredArgType;
                rewiredArgs[argName] = arg;
            }
        });
        return rewiredArgs;
    }
    function rewireNamedType(type) {
        if (isObjectType(type)) {
            const config = type.toConfig();
            const newConfig = {
                ...config,
                fields: ()=>rewireFields(config.fields)
                ,
                interfaces: ()=>rewireNamedTypes(config.interfaces)
            };
            return new GraphQLObjectType(newConfig);
        } else if (isInterfaceType(type)) {
            const config = type.toConfig();
            const newConfig = {
                ...config,
                fields: ()=>rewireFields(config.fields)
            };
            if ('interfaces' in newConfig) {
                newConfig.interfaces = ()=>rewireNamedTypes(config.interfaces)
                ;
            }
            return new GraphQLInterfaceType(newConfig);
        } else if (isUnionType(type)) {
            const config = type.toConfig();
            const newConfig = {
                ...config,
                types: ()=>rewireNamedTypes(config.types)
            };
            return new GraphQLUnionType(newConfig);
        } else if (isInputObjectType(type)) {
            const config = type.toConfig();
            const newConfig = {
                ...config,
                fields: ()=>rewireInputFields(config.fields)
            };
            return new GraphQLInputObjectType(newConfig);
        } else if (isEnumType(type)) {
            const enumConfig = type.toConfig();
            return new GraphQLEnumType(enumConfig);
        } else if (isScalarType(type)) {
            if (isSpecifiedScalarType(type)) {
                return type;
            }
            const scalarConfig = type.toConfig();
            return new GraphQLScalarType(scalarConfig);
        }
        throw new Error(`Unexpected schema type: ${type}`);
    }
    function rewireFields(fields) {
        const rewiredFields = {};
        Object.keys(fields).forEach((fieldName)=>{
            const field = fields[fieldName];
            const rewiredFieldType = rewireType(field.type);
            if (rewiredFieldType != null) {
                field.type = rewiredFieldType;
                field.args = rewireArgs(field.args);
                rewiredFields[fieldName] = field;
            }
        });
        return rewiredFields;
    }
    function rewireInputFields(fields) {
        const rewiredFields = {};
        Object.keys(fields).forEach((fieldName)=>{
            const field = fields[fieldName];
            const rewiredFieldType = rewireType(field.type);
            if (rewiredFieldType != null) {
                field.type = rewiredFieldType;
                rewiredFields[fieldName] = field;
            }
        });
        return rewiredFields;
    }
    function rewireNamedTypes(namedTypes) {
        const rewiredTypes = [];
        namedTypes.forEach((namedType)=>{
            const rewiredType = rewireType(namedType);
            if (rewiredType != null) {
                rewiredTypes.push(rewiredType);
            }
        });
        return rewiredTypes;
    }
    function rewireType(type) {
        if (isListType(type)) {
            const rewiredType = rewireType(type.ofType);
            return rewiredType != null ? new GraphQLList(rewiredType) : null;
        } else if (isNonNullType(type)) {
            const rewiredType = rewireType(type.ofType);
            return rewiredType != null ? new GraphQLNonNull(rewiredType) : null;
        } else if (isNamedType(type)) {
            let rewiredType = originalTypeMap[type.name];
            if (rewiredType === undefined) {
                rewiredType = isNamedStub(type) ? getBuiltInForStub(type) : type;
                newTypeMap[rewiredType.name] = rewiredType;
            }
            return rewiredType != null ? newTypeMap[rewiredType.name] : null;
        }
        return null;
    }
}
function pruneTypes(typeMap, directives) {
    const newTypeMap = {};
    const implementedInterfaces = {};
    Object.keys(typeMap).forEach((typeName)=>{
        const namedType = typeMap[typeName];
        if ('getInterfaces' in namedType) {
            namedType.getInterfaces().forEach((iface)=>{
                implementedInterfaces[iface.name] = true;
            });
        }
    });
    let prunedTypeMap = false;
    const typeNames = Object.keys(typeMap);
    for(let i = 0; i < typeNames.length; i++){
        const typeName = typeNames[i];
        const type = typeMap[typeName];
        if (isObjectType(type) || isInputObjectType(type)) {
            if (Object.keys(type.getFields()).length) {
                newTypeMap[typeName] = type;
            } else {
                prunedTypeMap = true;
            }
        } else if (isUnionType(type)) {
            if (type.getTypes().length) {
                newTypeMap[typeName] = type;
            } else {
                prunedTypeMap = true;
            }
        } else if (isInterfaceType(type)) {
            if (Object.keys(type.getFields()).length && implementedInterfaces[type.name]) {
                newTypeMap[typeName] = type;
            } else {
                prunedTypeMap = true;
            }
        } else {
            newTypeMap[typeName] = type;
        }
    }
    return prunedTypeMap ? rewireTypes(newTypeMap, directives) : {
        typeMap,
        directives
    };
}
function transformInputValue(type, value, transformer) {
    if (value == null) {
        return value;
    }
    const nullableType = getNullableType(type);
    if (isLeafType(nullableType)) {
        return transformer(nullableType, value);
    } else if (isListType(nullableType)) {
        return value.map((listMember)=>transformInputValue(nullableType.ofType, listMember, transformer)
        );
    } else if (isInputObjectType(nullableType)) {
        const fields = nullableType.getFields();
        const newValue = {};
        Object.keys(value).forEach((key)=>{
            newValue[key] = transformInputValue(fields[key].type, value[key], transformer);
        });
        return newValue;
    }
}
function serializeInputValue(type, value) {
    return transformInputValue(type, value, (t, v)=>t.serialize(v)
    );
}
function parseInputValue(type, value) {
    return transformInputValue(type, value, (t, v)=>t.parseValue(v)
    );
}
function healSchema(schema) {
    healTypes(schema.getTypeMap(), schema.getDirectives());
    return schema;
}
function healTypes(originalTypeMap, directives, config = {
    skipPruning: false
}) {
    const actualNamedTypeMap = Object.create(null);
    Object.entries(originalTypeMap).forEach(([typeName, namedType])=>{
        if (namedType == null || typeName.startsWith('__')) {
            return;
        }
        const actualName = namedType.name;
        if (actualName.startsWith('__')) {
            return;
        }
        if (actualName in actualNamedTypeMap) {
            throw new Error(`Duplicate schema type name ${actualName}`);
        }
        actualNamedTypeMap[actualName] = namedType;
    });
    Object.entries(actualNamedTypeMap).forEach(([typeName, namedType])=>{
        originalTypeMap[typeName] = namedType;
    });
    directives.forEach((decl)=>{
        decl.args = decl.args.filter((arg)=>{
            arg.type = healType(arg.type);
            return arg.type !== null;
        });
    });
    Object.entries(originalTypeMap).forEach(([typeName, namedType])=>{
        if (!typeName.startsWith('__') && typeName in actualNamedTypeMap) {
            if (namedType != null) {
                healNamedType(namedType);
            }
        }
    });
    for (const typeName1 of Object.keys(originalTypeMap)){
        if (!typeName1.startsWith('__') && !(typeName1 in actualNamedTypeMap)) {
            delete originalTypeMap[typeName1];
        }
    }
    if (!config.skipPruning) {
        pruneTypes1(originalTypeMap, directives);
    }
    function healNamedType(type) {
        if (isObjectType(type)) {
            healFields(type);
            healInterfaces(type);
            return;
        } else if (isInterfaceType(type)) {
            healFields(type);
            if ('getInterfaces' in type) {
                healInterfaces(type);
            }
            return;
        } else if (isUnionType(type)) {
            healUnderlyingTypes(type);
            return;
        } else if (isInputObjectType(type)) {
            healInputFields(type);
            return;
        } else if (isLeafType(type)) {
            return;
        }
        throw new Error(`Unexpected schema type: ${type}`);
    }
    function healFields(type) {
        const fieldMap = type.getFields();
        for (const [key, field] of Object.entries(fieldMap)){
            field.args.map((arg)=>{
                arg.type = healType(arg.type);
                return arg.type === null ? null : arg;
            }).filter(Boolean);
            field.type = healType(field.type);
            if (field.type === null) {
                delete fieldMap[key];
            }
        }
    }
    function healInterfaces(type) {
        if ('getInterfaces' in type) {
            const interfaces = type.getInterfaces();
            interfaces.push(...interfaces.splice(0).map((iface)=>healType(iface)
            ).filter(Boolean));
        }
    }
    function healInputFields(type) {
        const fieldMap = type.getFields();
        for (const [key, field] of Object.entries(fieldMap)){
            field.type = healType(field.type);
            if (field.type === null) {
                delete fieldMap[key];
            }
        }
    }
    function healUnderlyingTypes(type) {
        const types = type.getTypes();
        types.push(...types.splice(0).map((t)=>healType(t)
        ).filter(Boolean));
    }
    function healType(type) {
        if (isListType(type)) {
            const healedType = healType(type.ofType);
            return healedType != null ? new GraphQLList(healedType) : null;
        } else if (isNonNullType(type)) {
            const healedType = healType(type.ofType);
            return healedType != null ? new GraphQLNonNull(healedType) : null;
        } else if (isNamedType(type)) {
            const officialType = originalTypeMap[type.name];
            if (officialType && type !== officialType) {
                return officialType;
            }
        }
        return type;
    }
}
function pruneTypes1(typeMap, directives) {
    const implementedInterfaces = {};
    Object.values(typeMap).forEach((namedType)=>{
        if ('getInterfaces' in namedType) {
            namedType.getInterfaces().forEach((iface)=>{
                implementedInterfaces[iface.name] = true;
            });
        }
    });
    let prunedTypeMap = false;
    const typeNames = Object.keys(typeMap);
    for(let i = 0; i < typeNames.length; i++){
        const typeName = typeNames[i];
        const type = typeMap[typeName];
        if (isObjectType(type) || isInputObjectType(type)) {
            if (!Object.keys(type.getFields()).length) {
                typeMap[typeName] = null;
                prunedTypeMap = true;
            }
        } else if (isUnionType(type)) {
            if (!type.getTypes().length) {
                typeMap[typeName] = null;
                prunedTypeMap = true;
            }
        } else if (isInterfaceType(type)) {
            if (!Object.keys(type.getFields()).length || !(type.name in implementedInterfaces)) {
                typeMap[typeName] = null;
                prunedTypeMap = true;
            }
        }
    }
    if (prunedTypeMap) {
        healTypes(typeMap, directives);
    }
}
function inspect1(value) {
    return formatValue1(value, []);
}
function formatValue1(value, seenValues) {
    switch(typeof value){
        case 'string':
            return JSON.stringify(value);
        case 'function':
            return value.name ? `[function ${value.name}]` : '[function]';
        case 'object':
            if (value === null) {
                return 'null';
            }
            return formatObjectValue1(value, seenValues);
        default:
            return String(value);
    }
}
function formatObjectValue1(value, previouslySeenValues) {
    if (previouslySeenValues.indexOf(value) !== -1) {
        return '[Circular]';
    }
    const seenValues = [
        ...previouslySeenValues,
        value
    ];
    const customInspectFn = getCustomFn1(value);
    if (customInspectFn !== undefined) {
        const customValue = customInspectFn.call(value);
        if (customValue !== value) {
            return typeof customValue === 'string' ? customValue : formatValue1(customValue, seenValues);
        }
    } else if (Array.isArray(value)) {
        return formatArray1(value, seenValues);
    }
    return formatObject1(value, seenValues);
}
function formatObject1(object, seenValues) {
    const keys = Object.keys(object);
    if (keys.length === 0) {
        return '{}';
    }
    if (seenValues.length > 2) {
        return '[' + getObjectTag1(object) + ']';
    }
    const properties = keys.map((key)=>{
        const value = formatValue1(object[key], seenValues);
        return key + ': ' + value;
    });
    return '{ ' + properties.join(', ') + ' }';
}
function formatArray1(array, seenValues) {
    if (array.length === 0) {
        return '[]';
    }
    if (seenValues.length > 2) {
        return '[Array]';
    }
    const len = Math.min(10, array.length);
    const remaining = array.length - len;
    const items = [];
    for(let i = 0; i < len; ++i){
        items.push(formatValue1(array[i], seenValues));
    }
    if (remaining === 1) {
        items.push('... 1 more item');
    } else if (remaining > 1) {
        items.push(`... ${remaining.toString(10)} more items`);
    }
    return '[' + items.join(', ') + ']';
}
function getCustomFn1(obj) {
    if (typeof obj.inspect === 'function') {
        return obj.inspect;
    }
}
function getObjectTag1(obj) {
    const tag = Object.prototype.toString.call(obj).replace(/^\[object /, '').replace(/]$/, '');
    if (tag === 'Object' && typeof obj.constructor === 'function') {
        const name = obj.constructor.name;
        if (typeof name === 'string' && name !== '') {
            return name;
        }
    }
    return tag;
}
function mapSchema(schema, schemaMapper = {}) {
    const originalTypeMap = schema.getTypeMap();
    let newTypeMap = mapDefaultValues(originalTypeMap, schema, serializeInputValue);
    newTypeMap = mapTypes(newTypeMap, schema, schemaMapper, (type)=>isLeafType(type)
    );
    newTypeMap = mapEnumValues(newTypeMap, schema, schemaMapper);
    newTypeMap = mapDefaultValues(newTypeMap, schema, parseInputValue);
    newTypeMap = mapTypes(newTypeMap, schema, schemaMapper, (type)=>!isLeafType(type)
    );
    newTypeMap = mapFields(newTypeMap, schema, schemaMapper);
    newTypeMap = mapArguments(newTypeMap, schema, schemaMapper);
    const originalDirectives = schema.getDirectives();
    const newDirectives = mapDirectives(originalDirectives, schema, schemaMapper);
    const queryType = schema.getQueryType();
    const mutationType = schema.getMutationType();
    const subscriptionType = schema.getSubscriptionType();
    const newQueryTypeName = queryType != null ? newTypeMap[queryType.name] != null ? newTypeMap[queryType.name].name : undefined : undefined;
    const newMutationTypeName = mutationType != null ? newTypeMap[mutationType.name] != null ? newTypeMap[mutationType.name].name : undefined : undefined;
    const newSubscriptionTypeName = subscriptionType != null ? newTypeMap[subscriptionType.name] != null ? newTypeMap[subscriptionType.name].name : undefined : undefined;
    const { typeMap , directives  } = rewireTypes(newTypeMap, newDirectives);
    return new GraphQLSchema({
        ...schema.toConfig(),
        query: newQueryTypeName ? typeMap[newQueryTypeName] : undefined,
        mutation: newMutationTypeName ? typeMap[newMutationTypeName] : undefined,
        subscription: newSubscriptionTypeName != null ? typeMap[newSubscriptionTypeName] : undefined,
        types: Object.keys(typeMap).map((typeName)=>typeMap[typeName]
        ),
        directives
    });
}
function mapTypes(originalTypeMap, schema, schemaMapper, testFn = ()=>true
) {
    const newTypeMap = {};
    Object.keys(originalTypeMap).forEach((typeName)=>{
        if (!typeName.startsWith('__')) {
            const originalType = originalTypeMap[typeName];
            if (originalType == null || !testFn(originalType)) {
                newTypeMap[typeName] = originalType;
                return;
            }
            const typeMapper = getTypeMapper(schema, schemaMapper, typeName);
            if (typeMapper == null) {
                newTypeMap[typeName] = originalType;
                return;
            }
            const maybeNewType = typeMapper(originalType, schema);
            if (maybeNewType === undefined) {
                newTypeMap[typeName] = originalType;
                return;
            }
            newTypeMap[typeName] = maybeNewType;
        }
    });
    return newTypeMap;
}
function mapEnumValues(originalTypeMap, schema, schemaMapper) {
    const enumValueMapper = getEnumValueMapper(schemaMapper);
    if (!enumValueMapper) {
        return originalTypeMap;
    }
    return mapTypes(originalTypeMap, schema, {
        [MapperKind.ENUM_TYPE]: (type)=>{
            const config = type.toConfig();
            const originalEnumValueConfigMap = config.values;
            const newEnumValueConfigMap = {};
            Object.keys(originalEnumValueConfigMap).forEach((enumValueName)=>{
                const originalEnumValueConfig = originalEnumValueConfigMap[enumValueName];
                const mappedEnumValue = enumValueMapper(originalEnumValueConfig, type.name, schema);
                if (mappedEnumValue === undefined) {
                    newEnumValueConfigMap[enumValueName] = originalEnumValueConfig;
                } else if (Array.isArray(mappedEnumValue)) {
                    const [newEnumValueName, newEnumValueConfig] = mappedEnumValue;
                    newEnumValueConfigMap[newEnumValueName] = newEnumValueConfig;
                } else if (mappedEnumValue !== null) {
                    newEnumValueConfigMap[enumValueName] = mappedEnumValue;
                }
            });
            return new GraphQLEnumType({
                ...config,
                values: newEnumValueConfigMap
            });
        }
    }, (type)=>isEnumType(type)
    );
}
function mapDefaultValues(originalTypeMap, schema, fn) {
    const newTypeMap = mapArguments(originalTypeMap, schema, {
        [MapperKind.ARGUMENT]: (argumentConfig)=>{
            if (argumentConfig.defaultValue === undefined) {
                return argumentConfig;
            }
            const maybeNewType = getNewType(originalTypeMap, argumentConfig.type);
            if (maybeNewType != null) {
                return {
                    ...argumentConfig,
                    defaultValue: fn(maybeNewType, argumentConfig.defaultValue)
                };
            }
        }
    });
    return mapFields(newTypeMap, schema, {
        [MapperKind.INPUT_OBJECT_FIELD]: (inputFieldConfig)=>{
            if (inputFieldConfig.defaultValue === undefined) {
                return inputFieldConfig;
            }
            const maybeNewType = getNewType(newTypeMap, inputFieldConfig.type);
            if (maybeNewType != null) {
                return {
                    ...inputFieldConfig,
                    defaultValue: fn(maybeNewType, inputFieldConfig.defaultValue)
                };
            }
        }
    });
}
function getNewType(newTypeMap, type) {
    if (isListType(type)) {
        const newType = getNewType(newTypeMap, type.ofType);
        return newType != null ? new GraphQLList(newType) : null;
    } else if (isNonNullType(type)) {
        const newType = getNewType(newTypeMap, type.ofType);
        return newType != null ? new GraphQLNonNull(newType) : null;
    } else if (isNamedType(type)) {
        const newType = newTypeMap[type.name];
        return newType != null ? newType : null;
    }
    return null;
}
function mapFields(originalTypeMap, schema, schemaMapper) {
    const newTypeMap = {};
    Object.keys(originalTypeMap).forEach((typeName)=>{
        if (!typeName.startsWith('__')) {
            const originalType = originalTypeMap[typeName];
            if (!isObjectType(originalType) && !isInterfaceType(originalType) && !isInputObjectType(originalType)) {
                newTypeMap[typeName] = originalType;
                return;
            }
            const fieldMapper = getFieldMapper(schema, schemaMapper, typeName);
            if (fieldMapper == null) {
                newTypeMap[typeName] = originalType;
                return;
            }
            const config = originalType.toConfig();
            const originalFieldConfigMap = config.fields;
            const newFieldConfigMap = {};
            Object.keys(originalFieldConfigMap).forEach((fieldName)=>{
                const originalFieldConfig = originalFieldConfigMap[fieldName];
                const mappedField = fieldMapper(originalFieldConfig, fieldName, typeName, schema);
                if (mappedField === undefined) {
                    newFieldConfigMap[fieldName] = originalFieldConfig;
                } else if (Array.isArray(mappedField)) {
                    const [newFieldName, newFieldConfig] = mappedField;
                    newFieldConfigMap[newFieldName] = newFieldConfig;
                } else if (mappedField !== null) {
                    newFieldConfigMap[fieldName] = mappedField;
                }
            });
            if (isObjectType(originalType)) {
                newTypeMap[typeName] = new GraphQLObjectType({
                    ...config,
                    fields: newFieldConfigMap
                });
            } else if (isInterfaceType(originalType)) {
                newTypeMap[typeName] = new GraphQLInterfaceType({
                    ...config,
                    fields: newFieldConfigMap
                });
            } else {
                newTypeMap[typeName] = new GraphQLInputObjectType({
                    ...config,
                    fields: newFieldConfigMap
                });
            }
        }
    });
    return newTypeMap;
}
function mapArguments(originalTypeMap, schema, schemaMapper) {
    const newTypeMap = {};
    Object.keys(originalTypeMap).forEach((typeName)=>{
        if (!typeName.startsWith('__')) {
            const originalType = originalTypeMap[typeName];
            if (!isObjectType(originalType) && !isInterfaceType(originalType)) {
                newTypeMap[typeName] = originalType;
                return;
            }
            const argumentMapper = getArgumentMapper(schemaMapper);
            if (argumentMapper == null) {
                newTypeMap[typeName] = originalType;
                return;
            }
            const config = originalType.toConfig();
            const originalFieldConfigMap = config.fields;
            const newFieldConfigMap = {};
            Object.keys(originalFieldConfigMap).forEach((fieldName)=>{
                const originalFieldConfig = originalFieldConfigMap[fieldName];
                const originalArgumentConfigMap = originalFieldConfig.args;
                if (originalArgumentConfigMap == null) {
                    newFieldConfigMap[fieldName] = originalFieldConfig;
                    return;
                }
                const argumentNames = Object.keys(originalArgumentConfigMap);
                if (!argumentNames.length) {
                    newFieldConfigMap[fieldName] = originalFieldConfig;
                    return;
                }
                const newArgumentConfigMap = {};
                argumentNames.forEach((argumentName)=>{
                    const originalArgumentConfig = originalArgumentConfigMap[argumentName];
                    const mappedArgument = argumentMapper(originalArgumentConfig, fieldName, typeName, schema);
                    if (mappedArgument === undefined) {
                        newArgumentConfigMap[argumentName] = originalArgumentConfig;
                    } else if (Array.isArray(mappedArgument)) {
                        const [newArgumentName, newArgumentConfig] = mappedArgument;
                        newArgumentConfigMap[newArgumentName] = newArgumentConfig;
                    } else if (mappedArgument !== null) {
                        newArgumentConfigMap[argumentName] = mappedArgument;
                    }
                });
                newFieldConfigMap[fieldName] = {
                    ...originalFieldConfig,
                    args: newArgumentConfigMap
                };
            });
            if (isObjectType(originalType)) {
                newTypeMap[typeName] = new GraphQLObjectType({
                    ...config,
                    fields: newFieldConfigMap
                });
            } else if (isInterfaceType(originalType)) {
                newTypeMap[typeName] = new GraphQLInterfaceType({
                    ...config,
                    fields: newFieldConfigMap
                });
            } else {
                newTypeMap[typeName] = new GraphQLInputObjectType({
                    ...config,
                    fields: newFieldConfigMap
                });
            }
        }
    });
    return newTypeMap;
}
function mapDirectives(originalDirectives, schema, schemaMapper) {
    const directiveMapper = getDirectiveMapper(schemaMapper);
    if (directiveMapper == null) {
        return originalDirectives.slice();
    }
    const newDirectives = [];
    originalDirectives.forEach((directive)=>{
        const mappedDirective = directiveMapper(directive, schema);
        if (mappedDirective === undefined) {
            newDirectives.push(directive);
        } else if (mappedDirective !== null) {
            newDirectives.push(mappedDirective);
        }
    });
    return newDirectives;
}
function getTypeSpecifiers(schema, typeName) {
    const type = schema.getType(typeName);
    const specifiers = [
        MapperKind.TYPE
    ];
    if (isObjectType(type)) {
        specifiers.push(MapperKind.COMPOSITE_TYPE, MapperKind.OBJECT_TYPE);
        const query = schema.getQueryType();
        const mutation = schema.getMutationType();
        const subscription = schema.getSubscriptionType();
        if (query != null && typeName === query.name) {
            specifiers.push(MapperKind.ROOT_OBJECT, MapperKind.QUERY);
        } else if (mutation != null && typeName === mutation.name) {
            specifiers.push(MapperKind.ROOT_OBJECT, MapperKind.MUTATION);
        } else if (subscription != null && typeName === subscription.name) {
            specifiers.push(MapperKind.ROOT_OBJECT, MapperKind.SUBSCRIPTION);
        }
    } else if (isInputObjectType(type)) {
        specifiers.push(MapperKind.INPUT_OBJECT_TYPE);
    } else if (isInterfaceType(type)) {
        specifiers.push(MapperKind.COMPOSITE_TYPE, MapperKind.ABSTRACT_TYPE, MapperKind.INTERFACE_TYPE);
    } else if (isUnionType(type)) {
        specifiers.push(MapperKind.COMPOSITE_TYPE, MapperKind.ABSTRACT_TYPE, MapperKind.UNION_TYPE);
    } else if (isEnumType(type)) {
        specifiers.push(MapperKind.ENUM_TYPE);
    } else if (isScalarType(type)) {
        specifiers.push(MapperKind.SCALAR_TYPE);
    }
    return specifiers;
}
function getTypeMapper(schema, schemaMapper, typeName) {
    const specifiers = getTypeSpecifiers(schema, typeName);
    let typeMapper;
    const stack = [
        ...specifiers
    ];
    while(!typeMapper && stack.length > 0){
        const next = stack.pop();
        typeMapper = next && schemaMapper[next];
    }
    return typeMapper != null ? typeMapper : null;
}
function getFieldSpecifiers(schema, typeName) {
    const type = schema.getType(typeName);
    const specifiers = [
        MapperKind.FIELD
    ];
    if (isObjectType(type)) {
        specifiers.push(MapperKind.COMPOSITE_FIELD, MapperKind.OBJECT_FIELD);
        const query = schema.getQueryType();
        const mutation = schema.getMutationType();
        const subscription = schema.getSubscriptionType();
        if (query != null && typeName === query.name) {
            specifiers.push(MapperKind.ROOT_FIELD, MapperKind.QUERY_ROOT_FIELD);
        } else if (mutation != null && typeName === mutation.name) {
            specifiers.push(MapperKind.ROOT_FIELD, MapperKind.MUTATION_ROOT_FIELD);
        } else if (subscription != null && typeName === subscription.name) {
            specifiers.push(MapperKind.ROOT_FIELD, MapperKind.SUBSCRIPTION_ROOT_FIELD);
        }
    } else if (isInterfaceType(type)) {
        specifiers.push(MapperKind.COMPOSITE_FIELD, MapperKind.INTERFACE_FIELD);
    } else if (isInputObjectType(type)) {
        specifiers.push(MapperKind.INPUT_OBJECT_FIELD);
    }
    return specifiers;
}
function getFieldMapper(schema, schemaMapper, typeName) {
    const specifiers = getFieldSpecifiers(schema, typeName);
    let fieldMapper;
    const stack = [
        ...specifiers
    ];
    while(!fieldMapper && stack.length > 0){
        const next = stack.pop();
        fieldMapper = next && schemaMapper[next];
    }
    return fieldMapper != null ? fieldMapper : null;
}
function getArgumentMapper(schemaMapper) {
    const argumentMapper = schemaMapper[MapperKind.ARGUMENT];
    return argumentMapper != null ? argumentMapper : null;
}
function getDirectiveMapper(schemaMapper) {
    const directiveMapper = schemaMapper[MapperKind.DIRECTIVE];
    return directiveMapper != null ? directiveMapper : null;
}
function getEnumValueMapper(schemaMapper) {
    const enumValueMapper = schemaMapper[MapperKind.ENUM_VALUE];
    return enumValueMapper != null ? enumValueMapper : null;
}
function forEachField(schema, fn) {
    const typeMap = schema.getTypeMap();
    Object.keys(typeMap).forEach((typeName)=>{
        const type = typeMap[typeName];
        if (!getNamedType(type).name.startsWith('__') && isObjectType(type)) {
            const fields = type.getFields();
            Object.keys(fields).forEach((fieldName)=>{
                const field = fields[fieldName];
                fn(field, typeName, fieldName);
            });
        }
    });
}
function forEachDefaultValue(schema, fn) {
    const typeMap = schema.getTypeMap();
    Object.keys(typeMap).forEach((typeName)=>{
        const type = typeMap[typeName];
        if (!getNamedType(type).name.startsWith('__')) {
            if (isObjectType(type)) {
                const fields = type.getFields();
                Object.keys(fields).forEach((fieldName)=>{
                    const field = fields[fieldName];
                    field.args.forEach((arg)=>{
                        arg.defaultValue = fn(arg.type, arg.defaultValue);
                    });
                });
            } else if (isInputObjectType(type)) {
                const fields = type.getFields();
                Object.keys(fields).forEach((fieldName)=>{
                    const field = fields[fieldName];
                    field.defaultValue = fn(field.type, field.defaultValue);
                });
            }
        }
    });
}
function getArgumentValues1(def, node, variableValues = {}) {
    const variableMap = Object.entries(variableValues).reduce((prev, [key, value])=>({
            ...prev,
            [key]: value
        })
    , {});
    const coercedValues = {};
    const argumentNodes = node.arguments ?? [];
    const argNodeMap = argumentNodes.reduce((prev, arg)=>({
            ...prev,
            [arg.name.value]: arg
        })
    , {});
    for (const argDef of def.args){
        const name = argDef.name;
        const argType = argDef.type;
        const argumentNode = argNodeMap[name];
        if (!argumentNode) {
            if (argDef.defaultValue !== undefined) {
                coercedValues[name] = argDef.defaultValue;
            } else if (isNonNullType(argType)) {
                throw new GraphQLError(`Argument "${name}" of required type "${inspect1(argType)}" ` + 'was not provided.', node);
            }
            continue;
        }
        const valueNode = argumentNode.value;
        let isNull = valueNode.kind === Kind.NULL;
        if (valueNode.kind === Kind.VARIABLE) {
            const variableName = valueNode.name.value;
            if (variableValues == null || !(variableName in variableMap)) {
                if (argDef.defaultValue !== undefined) {
                    coercedValues[name] = argDef.defaultValue;
                } else if (isNonNullType(argType)) {
                    throw new GraphQLError(`Argument "${name}" of required type "${inspect1(argType)}" ` + `was provided the variable "$${variableName}" which was not provided a runtime value.`, valueNode);
                }
                continue;
            }
            isNull = variableValues[variableName] == null;
        }
        if (isNull && isNonNullType(argType)) {
            throw new GraphQLError(`Argument "${name}" of non-null type "${inspect1(argType)}" ` + 'must not be null.', valueNode);
        }
        const coercedValue = valueFromAST(valueNode, argType, variableValues);
        if (coercedValue === undefined) {
            throw new GraphQLError(`Argument "${name}" has invalid value ${print(valueNode)}.`, valueNode);
        }
        coercedValues[name] = coercedValue;
    }
    return coercedValues;
}
function isSchemaVisitor(obj) {
    if ('schema' in obj && isSchema(obj.schema)) {
        if ('visitSchema' in obj && typeof obj.visitSchema === 'function') {
            return true;
        }
    }
    return false;
}
function visitSchema(schema, visitorOrVisitorSelector) {
    const visitorSelector = typeof visitorOrVisitorSelector === 'function' ? visitorOrVisitorSelector : ()=>visitorOrVisitorSelector
    ;
    function callMethod(methodName, type, ...args) {
        let visitors = visitorSelector(type, methodName);
        visitors = Array.isArray(visitors) ? visitors : [
            visitors
        ];
        let finalType = type;
        visitors.every((visitorOrVisitorDef)=>{
            let newType;
            if (isSchemaVisitor(visitorOrVisitorDef)) {
                newType = visitorOrVisitorDef[methodName](finalType, ...args);
            } else if (isNamedType(finalType) && (methodName === 'visitScalar' || methodName === 'visitEnum' || methodName === 'visitObject' || methodName === 'visitInputObject' || methodName === 'visitUnion' || methodName === 'visitInterface')) {
                const specifiers = getTypeSpecifiers1(finalType, schema);
                const typeVisitor = getVisitor(visitorOrVisitorDef, specifiers);
                newType = typeVisitor != null ? typeVisitor(finalType, schema) : undefined;
            }
            if (typeof newType === 'undefined') {
                return true;
            }
            if (methodName === 'visitSchema' || isSchema(finalType)) {
                throw new Error(`Method ${methodName} cannot replace schema with ${newType}`);
            }
            if (newType === null) {
                finalType = null;
                return false;
            }
            finalType = newType;
            return true;
        });
        return finalType;
    }
    function visit1(type) {
        if (isSchema(type)) {
            callMethod('visitSchema', type);
            const typeMap = type.getTypeMap();
            Object.entries(typeMap).forEach(([typeName, namedType])=>{
                if (!typeName.startsWith('__') && namedType != null) {
                    typeMap[typeName] = visit1(namedType);
                }
            });
            return type;
        }
        if (isObjectType(type)) {
            const newObject = callMethod('visitObject', type);
            if (newObject != null) {
                visitFields(newObject);
            }
            return newObject;
        }
        if (isInterfaceType(type)) {
            const newInterface = callMethod('visitInterface', type);
            if (newInterface != null) {
                visitFields(newInterface);
            }
            return newInterface;
        }
        if (isInputObjectType(type)) {
            const newInputObject = callMethod('visitInputObject', type);
            if (newInputObject != null) {
                const fieldMap = newInputObject.getFields();
                for (const key of Object.keys(fieldMap)){
                    fieldMap[key] = callMethod('visitInputFieldDefinition', fieldMap[key], {
                        objectType: newInputObject
                    });
                    if (!fieldMap[key]) {
                        delete fieldMap[key];
                    }
                }
            }
            return newInputObject;
        }
        if (isScalarType(type)) {
            return callMethod('visitScalar', type);
        }
        if (isUnionType(type)) {
            return callMethod('visitUnion', type);
        }
        if (isEnumType(type)) {
            let newEnum = callMethod('visitEnum', type);
            if (newEnum != null) {
                const newValues = newEnum.getValues().map((value)=>callMethod('visitEnumValue', value, {
                        enumType: newEnum
                    })
                ).filter(Boolean);
                const valuesUpdated = newValues.some((value, index)=>value !== newEnum.getValues()[index]
                );
                if (valuesUpdated) {
                    newEnum = new GraphQLEnumType({
                        ...newEnum.toConfig(),
                        values: newValues.reduce((prev, value)=>({
                                ...prev,
                                [value.name]: {
                                    value: value.value,
                                    deprecationReason: value.deprecationReason,
                                    description: value.description,
                                    astNode: value.astNode
                                }
                            })
                        , {})
                    });
                }
            }
            return newEnum;
        }
        throw new Error(`Unexpected schema type: ${type}`);
    }
    function visitFields(type) {
        const fieldMap = type.getFields();
        for (const [key, field] of Object.entries(fieldMap)){
            const newField = callMethod('visitFieldDefinition', field, {
                objectType: type
            });
            if (newField.args != null) {
                newField.args = newField.args.map((arg)=>callMethod('visitArgumentDefinition', arg, {
                        field: newField,
                        objectType: type
                    })
                ).filter(Boolean);
            }
            if (newField) {
                fieldMap[key] = newField;
            } else {
                delete fieldMap[key];
            }
        }
    }
    visit1(schema);
    healSchema(schema);
    return schema;
}
class SchemaDirectiveVisitor extends SchemaVisitor {
    name;
    args;
    visitedType;
    context;
    static getDirectiveDeclaration(directiveName, schema) {
        return schema.getDirective(directiveName);
    }
    static visitSchemaDirectives(schema, directiveVisitors, context = Object.create(null)) {
        const declaredDirectives = this.getDeclaredDirectives(schema, directiveVisitors);
        const createdVisitors = Object.keys(directiveVisitors).reduce((prev, item)=>({
                ...prev,
                [item]: []
            })
        , {});
        const directiveVisitorMap = Object.entries(directiveVisitors).reduce((prev, [key, value])=>({
                ...prev,
                [key]: value
            })
        , {});
        function visitorSelector(type, methodName) {
            let directiveNodes = type?.astNode?.directives ?? [];
            const extensionASTNodes = type.extensionASTNodes;
            if (extensionASTNodes != null) {
                extensionASTNodes.forEach((extensionASTNode)=>{
                    if (extensionASTNode.directives != null) {
                        directiveNodes = directiveNodes.concat(extensionASTNode.directives);
                    }
                });
            }
            const visitors = [];
            directiveNodes.forEach((directiveNode)=>{
                const directiveName = directiveNode.name.value;
                if (!(directiveName in directiveVisitorMap)) {
                    return;
                }
                const VisitorClass = directiveVisitorMap[directiveName];
                if (!VisitorClass.implementsVisitorMethod(methodName)) {
                    return;
                }
                const decl = declaredDirectives[directiveName];
                let args;
                if (decl != null) {
                    args = getArgumentValues1(decl, directiveNode);
                } else {
                    args = Object.create(null);
                    if (directiveNode.arguments != null) {
                        directiveNode.arguments.forEach((arg)=>{
                            args[arg.name.value] = valueFromASTUntyped(arg.value);
                        });
                    }
                }
                visitors.push(new VisitorClass({
                    name: directiveName,
                    args,
                    visitedType: type,
                    schema,
                    context
                }));
            });
            if (visitors.length > 0) {
                visitors.forEach((visitor)=>{
                    createdVisitors[visitor.name].push(visitor);
                });
            }
            return visitors;
        }
        visitSchema(schema, visitorSelector);
        return createdVisitors;
    }
    static getDeclaredDirectives(schema, directiveVisitors) {
        const declaredDirectives = schema.getDirectives().reduce((prev, curr)=>({
                ...prev,
                [curr.name]: curr
            })
        , {});
        Object.entries(directiveVisitors).forEach(([directiveName, visitorClass])=>{
            const decl = visitorClass.getDirectiveDeclaration(directiveName, schema);
            if (decl != null) {
                declaredDirectives[directiveName] = decl;
            }
        });
        Object.entries(declaredDirectives).forEach(([name, decl])=>{
            if (!(name in directiveVisitors)) {
                return;
            }
            const visitorClass = directiveVisitors[name];
            decl.locations.forEach((loc)=>{
                const visitorMethodName = directiveLocationToVisitorMethodName(loc);
                if (SchemaVisitor.implementsVisitorMethod(visitorMethodName) && !visitorClass.implementsVisitorMethod(visitorMethodName)) {
                    throw new Error(`SchemaDirectiveVisitor for @${name} must implement ${visitorMethodName} method`);
                }
            });
        });
        return declaredDirectives;
    }
    constructor(config){
        super();
        this.name = config.name;
        this.args = config.args;
        this.visitedType = config.visitedType;
        this.schema = config.schema;
        this.context = config.context;
    }
}
function getDirectives(schema, node) {
    const schemaDirectives = schema && schema.getDirectives ? schema.getDirectives() : [];
    const schemaDirectiveMap1 = schemaDirectives.reduce((schemaDirectiveMap, schemaDirective)=>{
        schemaDirectiveMap[schemaDirective.name] = schemaDirective;
        return schemaDirectiveMap;
    }, {});
    let astNodes = [];
    if (node.astNode) {
        astNodes.push(node.astNode);
    }
    if ('extensionASTNodes' in node && node.extensionASTNodes) {
        astNodes = [
            ...astNodes,
            ...node.extensionASTNodes
        ];
    }
    const result = {};
    astNodes.forEach((astNode)=>{
        if (astNode.directives) {
            astNode.directives.forEach((directive)=>{
                const schemaDirective = schemaDirectiveMap1[directive.name.value];
                if (schemaDirective) {
                    const directiveValue = getDirectiveValues1(schemaDirective, astNode);
                    if (schemaDirective.isRepeatable) {
                        if (result[schemaDirective.name]) {
                            result[schemaDirective.name] = result[schemaDirective.name].concat([
                                directiveValue
                            ]);
                        } else {
                            result[schemaDirective.name] = [
                                directiveValue
                            ];
                        }
                    } else {
                        result[schemaDirective.name] = directiveValue;
                    }
                }
            });
        }
    });
    return result;
}
function directiveLocationToVisitorMethodName(loc) {
    return 'visit' + loc.replace(/([^_]*)_?/g, (_wholeMatch, part)=>part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    );
}
function getTypeSpecifiers1(type, schema) {
    const specifiers = [
        VisitSchemaKind.TYPE
    ];
    if (isObjectType(type)) {
        specifiers.push(VisitSchemaKind.COMPOSITE_TYPE, VisitSchemaKind.OBJECT_TYPE);
        const query = schema.getQueryType();
        const mutation = schema.getMutationType();
        const subscription = schema.getSubscriptionType();
        if (type === query) {
            specifiers.push(VisitSchemaKind.ROOT_OBJECT, VisitSchemaKind.QUERY);
        } else if (type === mutation) {
            specifiers.push(VisitSchemaKind.ROOT_OBJECT, VisitSchemaKind.MUTATION);
        } else if (type === subscription) {
            specifiers.push(VisitSchemaKind.ROOT_OBJECT, VisitSchemaKind.SUBSCRIPTION);
        }
    } else if (isInputType(type)) {
        specifiers.push(VisitSchemaKind.INPUT_OBJECT_TYPE);
    } else if (isInterfaceType(type)) {
        specifiers.push(VisitSchemaKind.COMPOSITE_TYPE, VisitSchemaKind.ABSTRACT_TYPE, VisitSchemaKind.INTERFACE_TYPE);
    } else if (isUnionType(type)) {
        specifiers.push(VisitSchemaKind.COMPOSITE_TYPE, VisitSchemaKind.ABSTRACT_TYPE, VisitSchemaKind.UNION_TYPE);
    } else if (isEnumType(type)) {
        specifiers.push(VisitSchemaKind.ENUM_TYPE);
    } else if (isScalarType(type)) {
        specifiers.push(VisitSchemaKind.SCALAR_TYPE);
    }
    return specifiers;
}
function getVisitor(visitorDef, specifiers) {
    let typeVisitor;
    const stack = [
        ...specifiers
    ];
    while(!typeVisitor && stack.length > 0){
        const next = stack.pop();
        typeVisitor = next && visitorDef[next];
    }
    return typeVisitor != null ? typeVisitor : null;
}
function getDirectiveValues1(directiveDef, node) {
    if (node.directives) {
        if (directiveDef.isRepeatable) {
            const directiveNodes = node.directives.filter((directive)=>directive.name.value === directiveDef.name
            );
            return directiveNodes.map((directiveNode)=>getArgumentValues1(directiveDef, directiveNode)
            );
        }
        const directiveNode1 = node.directives.find((directive)=>directive.name.value === directiveDef.name
        );
        return getArgumentValues1(directiveDef, directiveNode1);
    }
}
function checkForResolveTypeResolver(schema, requireResolversForResolveType) {
    Object.keys(schema.getTypeMap()).map((typeName)=>schema.getType(typeName)
    ).forEach((type)=>{
        if (!isAbstractType(type)) return;
        if (!type.resolveType) {
            if (!requireResolversForResolveType) {
                return;
            }
            throw new Error(`Type "${type.name}" is missing a "__resolveType" resolver. Pass false into ` + '"resolverValidationOptions.requireResolversForResolveType" to disable this error.');
        }
    });
}
function extendResolversFromInterfaces(schema, resolvers1) {
    const typeNames = Object.keys({
        ...schema.getTypeMap(),
        ...resolvers1
    });
    const extendedResolvers = {};
    typeNames.forEach((typeName)=>{
        const type = schema.getType(typeName);
        if ('getInterfaces' in type) {
            const allInterfaceResolvers = type.getInterfaces().map((iFace)=>resolvers1[iFace.name]
            ).filter((interfaceResolvers)=>interfaceResolvers != null
            );
            extendedResolvers[typeName] = {};
            allInterfaceResolvers.forEach((interfaceResolvers)=>{
                Object.keys(interfaceResolvers).forEach((fieldName)=>{
                    if (fieldName === '__isTypeOf' || !fieldName.startsWith('__')) {
                        extendedResolvers[typeName][fieldName] = interfaceResolvers[fieldName];
                    }
                });
            });
            const typeResolvers = resolvers1[typeName];
            extendedResolvers[typeName] = {
                ...extendedResolvers[typeName],
                ...typeResolvers
            };
        } else {
            const typeResolvers = resolvers1[typeName];
            if (typeResolvers != null) {
                extendedResolvers[typeName] = typeResolvers;
            }
        }
    });
    return extendedResolvers;
}
function addResolversToSchema(schemaOrOptions, legacyInputResolvers, legacyInputValidationOptions) {
    const options = isSchema(schemaOrOptions) ? {
        schema: schemaOrOptions,
        resolvers: legacyInputResolvers,
        resolverValidationOptions: legacyInputValidationOptions
    } : schemaOrOptions;
    let { schema , resolvers: inputResolvers , defaultFieldResolver: defaultFieldResolver1 , resolverValidationOptions ={} , inheritResolversFromInterfaces =false , updateResolversInPlace =false  } = options;
    const { allowResolversNotInSchema =false , requireResolversForResolveType  } = resolverValidationOptions;
    const resolvers2 = inheritResolversFromInterfaces ? extendResolversFromInterfaces(schema, inputResolvers) : inputResolvers;
    Object.keys(resolvers2).forEach((typeName)=>{
        const resolverValue = resolvers2[typeName];
        const resolverType = typeof resolverValue;
        if (typeName === '__schema') {
            if (resolverType !== 'function') {
                throw new Error(`"${typeName}" defined in resolvers, but has invalid value "${resolverValue}". A schema resolver's value must be of type object or function.`);
            }
        } else {
            if (resolverType !== 'object') {
                throw new Error(`"${typeName}" defined in resolvers, but has invalid value "${resolverValue}". The resolver's value must be of type object.`);
            }
            const type = schema.getType(typeName);
            if (type == null) {
                if (allowResolversNotInSchema) {
                    return;
                }
                throw new Error(`"${typeName}" defined in resolvers, but not in schema`);
            } else if (isSpecifiedScalarType(type)) {
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        type[fieldName.substring(2)] = resolverValue[fieldName];
                    } else {
                        type[fieldName] = resolverValue[fieldName];
                    }
                });
            }
        }
    });
    schema = updateResolversInPlace ? addResolversToExistingSchema({
        schema,
        resolvers: resolvers2,
        defaultFieldResolver: defaultFieldResolver1,
        allowResolversNotInSchema
    }) : createNewSchemaWithResolvers({
        schema,
        resolvers: resolvers2,
        defaultFieldResolver: defaultFieldResolver1,
        allowResolversNotInSchema
    });
    checkForResolveTypeResolver(schema, requireResolversForResolveType);
    return schema;
}
function addResolversToExistingSchema({ schema , resolvers: resolvers3 , defaultFieldResolver: defaultFieldResolver2 , allowResolversNotInSchema  }) {
    const typeMap = schema.getTypeMap();
    Object.keys(resolvers3).forEach((typeName)=>{
        if (typeName !== '__schema') {
            const type = schema.getType(typeName);
            const resolverValue = resolvers3[typeName];
            if (isScalarType(type)) {
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        type[fieldName.substring(2)] = resolverValue[fieldName];
                    } else {
                        type[fieldName] = resolverValue[fieldName];
                    }
                });
            } else if (isEnumType(type)) {
                const config = type.toConfig();
                const enumValueConfigMap = config.values;
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        config[fieldName.substring(2)] = resolverValue[fieldName];
                    } else if (!enumValueConfigMap[fieldName]) {
                        if (allowResolversNotInSchema) {
                            return;
                        }
                        throw new Error(`${type.name}.${fieldName} was defined in resolvers, but not present within ${type.name}`);
                    } else {
                        enumValueConfigMap[fieldName].value = resolverValue[fieldName];
                    }
                });
                typeMap[typeName] = new GraphQLEnumType(config);
            } else if (isUnionType(type)) {
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        type[fieldName.substring(2)] = resolverValue[fieldName];
                        return;
                    }
                    if (allowResolversNotInSchema) {
                        return;
                    }
                    throw new Error(`${type.name}.${fieldName} was defined in resolvers, but ${type.name} is not an object or interface type`);
                });
            } else if (isObjectType(type) || isInterfaceType(type)) {
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        type[fieldName.substring(2)] = resolverValue[fieldName];
                        return;
                    }
                    const fields = type.getFields();
                    const field = fields[fieldName];
                    if (field == null) {
                        if (allowResolversNotInSchema) {
                            return;
                        }
                        throw new Error(`${typeName}.${fieldName} defined in resolvers, but not in schema`);
                    }
                    const fieldResolve = resolverValue[fieldName];
                    if (typeof fieldResolve === 'function') {
                        field.resolve = fieldResolve;
                    } else {
                        if (typeof fieldResolve !== 'object') {
                            throw new Error(`Resolver ${typeName}.${fieldName} must be object or function`);
                        }
                        setFieldProperties(field, fieldResolve);
                    }
                });
            }
        }
    });
    forEachDefaultValue(schema, serializeInputValue);
    healSchema(schema);
    forEachDefaultValue(schema, parseInputValue);
    if (defaultFieldResolver2 != null) {
        forEachField(schema, (field)=>{
            if (!field.resolve) {
                field.resolve = defaultFieldResolver2;
            }
        });
    }
    return schema;
}
function createNewSchemaWithResolvers({ schema , resolvers: resolvers4 , defaultFieldResolver: defaultFieldResolver3 , allowResolversNotInSchema  }) {
    schema = mapSchema(schema, {
        [MapperKind.SCALAR_TYPE]: (type)=>{
            const config = type.toConfig();
            const resolverValue = resolvers4[type.name];
            if (!isSpecifiedScalarType(type) && resolverValue != null) {
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        config[fieldName.substring(2)] = resolverValue[fieldName];
                    } else {
                        config[fieldName] = resolverValue[fieldName];
                    }
                });
                return new GraphQLScalarType(config);
            }
        },
        [MapperKind.ENUM_TYPE]: (type)=>{
            const resolverValue = resolvers4[type.name];
            const config = type.toConfig();
            const enumValueConfigMap = config.values;
            if (resolverValue != null) {
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        config[fieldName.substring(2)] = resolverValue[fieldName];
                    } else if (!enumValueConfigMap[fieldName]) {
                        if (allowResolversNotInSchema) {
                            return;
                        }
                        throw new Error(`${type.name}.${fieldName} was defined in resolvers, but not present within ${type.name}`);
                    } else {
                        enumValueConfigMap[fieldName].value = resolverValue[fieldName];
                    }
                });
                return new GraphQLEnumType(config);
            }
        },
        [MapperKind.UNION_TYPE]: (type)=>{
            const resolverValue = resolvers4[type.name];
            if (resolverValue != null) {
                const config = type.toConfig();
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        config[fieldName.substring(2)] = resolverValue[fieldName];
                        return;
                    }
                    if (allowResolversNotInSchema) {
                        return;
                    }
                    throw new Error(`${type.name}.${fieldName} was defined in resolvers, but ${type.name} is not an object or interface type`);
                });
                return new GraphQLUnionType(config);
            }
        },
        [MapperKind.OBJECT_TYPE]: (type)=>{
            const resolverValue = resolvers4[type.name];
            if (resolverValue != null) {
                const config = type.toConfig();
                const fields = config.fields;
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        config[fieldName.substring(2)] = resolverValue[fieldName];
                        return;
                    }
                    const field = fields[fieldName];
                    if (field == null) {
                        if (allowResolversNotInSchema) {
                            return;
                        }
                        throw new Error(`${type.name}.${fieldName} defined in resolvers, but not in schema`);
                    }
                });
                return new GraphQLObjectType(config);
            }
        },
        [MapperKind.INTERFACE_TYPE]: (type)=>{
            const resolverValue = resolvers4[type.name];
            if (resolverValue != null) {
                const config = type.toConfig();
                const fields = config.fields;
                Object.keys(resolverValue).forEach((fieldName)=>{
                    if (fieldName.startsWith('__')) {
                        config[fieldName.substring(2)] = resolverValue[fieldName];
                        return;
                    }
                    const field = fields[fieldName];
                    if (field == null) {
                        if (allowResolversNotInSchema) {
                            return;
                        }
                        throw new Error(`${type.name}.${fieldName} defined in resolvers, but not in schema`);
                    }
                });
                return new GraphQLInterfaceType(config);
            }
        },
        [MapperKind.COMPOSITE_FIELD]: (fieldConfig, fieldName, typeName)=>{
            const resolverValue = resolvers4[typeName];
            if (resolverValue != null) {
                const fieldResolve = resolverValue[fieldName];
                if (fieldResolve != null) {
                    const newFieldConfig = {
                        ...fieldConfig
                    };
                    if (typeof fieldResolve === 'function') {
                        newFieldConfig.resolve = fieldResolve;
                    } else {
                        if (typeof fieldResolve !== 'object') {
                            throw new Error(`Resolver ${typeName}.${fieldName} must be object or function`);
                        }
                        setFieldProperties(newFieldConfig, fieldResolve);
                    }
                    return newFieldConfig;
                }
            }
        }
    });
    if (defaultFieldResolver3 != null) {
        schema = mapSchema(schema, {
            [MapperKind.OBJECT_FIELD]: (fieldConfig)=>({
                    ...fieldConfig,
                    resolve: fieldConfig.resolve != null ? fieldConfig.resolve : defaultFieldResolver3
                })
        });
    }
    return schema;
}
function setFieldProperties(field, propertiesObj) {
    Object.keys(propertiesObj).forEach((propertyName)=>{
        field[propertyName] = propertiesObj[propertyName];
    });
}
function attachDirectiveResolvers(schema, directiveResolvers) {
    if (typeof directiveResolvers !== 'object') {
        throw new Error(`Expected directiveResolvers to be of type object, got ${typeof directiveResolvers}`);
    }
    if (Array.isArray(directiveResolvers)) {
        throw new Error('Expected directiveResolvers to be of type object, got Array');
    }
    return mapSchema(schema, {
        [MapperKind.OBJECT_FIELD]: (fieldConfig)=>{
            const newFieldConfig = {
                ...fieldConfig
            };
            const directives = getDirectives(schema, fieldConfig);
            Object.keys(directives).forEach((directiveName)=>{
                if (directiveResolvers[directiveName]) {
                    const resolver = directiveResolvers[directiveName];
                    const originalResolver = newFieldConfig.resolve != null ? newFieldConfig.resolve : defaultFieldResolver;
                    const directiveArgs = directives[directiveName];
                    newFieldConfig.resolve = (source, originalArgs, context, info)=>{
                        return resolver(()=>new Promise((resolve, reject)=>{
                                const result = originalResolver(source, originalArgs, context, info);
                                if (result instanceof Error) {
                                    reject(result);
                                }
                                resolve(result);
                            })
                        , source, directiveArgs, context, info);
                    };
                }
            });
            return newFieldConfig;
        }
    });
}
function assertResolversPresent(schema, resolverValidationOptions = {}) {
    const { requireResolversForArgs =false , requireResolversForNonScalar =false , requireResolversForAllFields =false  } = resolverValidationOptions;
    if (requireResolversForAllFields && (requireResolversForArgs || requireResolversForNonScalar)) {
        throw new TypeError('requireResolversForAllFields takes precedence over the more specific assertions. ' + 'Please configure either requireResolversForAllFields or requireResolversForArgs / ' + 'requireResolversForNonScalar, but not a combination of them.');
    }
    forEachField(schema, (field, typeName, fieldName)=>{
        if (requireResolversForAllFields) {
            expectResolver(field, typeName, fieldName);
        }
        if (requireResolversForArgs && field.args.length > 0) {
            expectResolver(field, typeName, fieldName);
        }
        if (requireResolversForNonScalar && !isScalarType(getNamedType(field.type))) {
            expectResolver(field, typeName, fieldName);
        }
    });
}
function expectResolver(field, typeName, fieldName) {
    if (!field.resolve) {
        console.warn(`Resolver missing for "${typeName}.${fieldName}".
To disable this warning check pass;
resolverValidationOptions: {
  requireResolversForNonScalar: false
}
      `);
        return;
    }
    if (typeof field.resolve !== 'function') {
        throw new Error(`Resolver "${typeName}.${fieldName}" must be a function`);
    }
}
function addSchemaLevelResolver(schema1, fn) {
    const fnToRunOnlyOnce = runAtMostOncePerRequest(fn);
    return mapSchema(schema1, {
        [MapperKind.ROOT_FIELD]: (fieldConfig, _fieldName, typeName, schema)=>{
            const subscription = schema.getSubscriptionType();
            if (subscription != null && subscription.name === typeName) {
                return {
                    ...fieldConfig,
                    resolve: wrapResolver(fieldConfig.resolve, fn)
                };
            }
            return {
                ...fieldConfig,
                resolve: wrapResolver(fieldConfig.resolve, fnToRunOnlyOnce)
            };
        }
    });
}
function wrapResolver(innerResolver, outerResolver) {
    return (obj, args, ctx, info)=>resolveMaybePromise(outerResolver(obj, args, ctx, info), (root)=>{
            if (innerResolver != null) {
                return innerResolver(root, args, ctx, info);
            }
            return defaultFieldResolver(root, args, ctx, info);
        })
    ;
}
function isPromise1(maybePromise) {
    return maybePromise && typeof maybePromise.then === 'function';
}
function resolveMaybePromise(maybePromise, fulfillmentCallback) {
    if (isPromise1(maybePromise)) {
        return maybePromise.then(fulfillmentCallback);
    }
    return fulfillmentCallback(maybePromise);
}
function runAtMostOncePerRequest(fn) {
    let value;
    const randomNumber = Math.random();
    return (root, args, ctx, info)=>{
        if (!info.operation['__runAtMostOnce']) {
            info.operation['__runAtMostOnce'] = {};
        }
        if (!info.operation['__runAtMostOnce'][randomNumber]) {
            info.operation['__runAtMostOnce'][randomNumber] = true;
            value = fn(root, args, ctx, info);
        }
        return value;
    };
}
function extractExtensionDefinitions(ast) {
    const extensionDefs = ast.definitions.filter((def)=>def.kind === Kind.OBJECT_TYPE_EXTENSION || def.kind === Kind.INTERFACE_TYPE_EXTENSION || def.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION || def.kind === Kind.UNION_TYPE_EXTENSION || def.kind === Kind.ENUM_TYPE_EXTENSION || def.kind === Kind.SCALAR_TYPE_EXTENSION || def.kind === Kind.SCHEMA_EXTENSION
    );
    return {
        ...ast,
        definitions: extensionDefs
    };
}
function filterExtensionDefinitions(ast) {
    const extensionDefs = ast.definitions.filter((def)=>def.kind !== Kind.OBJECT_TYPE_EXTENSION && def.kind !== Kind.INTERFACE_TYPE_EXTENSION && def.kind !== Kind.INPUT_OBJECT_TYPE_EXTENSION && def.kind !== Kind.UNION_TYPE_EXTENSION && def.kind !== Kind.ENUM_TYPE_EXTENSION && def.kind !== Kind.SCALAR_TYPE_EXTENSION && def.kind !== Kind.SCHEMA_EXTENSION
    );
    return {
        ...ast,
        definitions: extensionDefs
    };
}
function concatenateTypeDefs(typeDefinitionsAry, calledFunctionRefs = []) {
    let resolvedTypeDefinitions = [];
    typeDefinitionsAry.forEach((typeDef)=>{
        if (typeof typeDef === 'function') {
            if (calledFunctionRefs.indexOf(typeDef) === -1) {
                calledFunctionRefs.push(typeDef);
                resolvedTypeDefinitions = resolvedTypeDefinitions.concat(concatenateTypeDefs(typeDef(), calledFunctionRefs));
            }
        } else if (typeof typeDef === 'string') {
            resolvedTypeDefinitions.push(typeDef.trim());
        } else if (typeDef.kind !== undefined) {
            resolvedTypeDefinitions.push(print(typeDef).trim());
        } else {
            const type = typeof typeDef;
            throw new Error(`typeDef array must contain only strings, documents, or functions, got ${type}`);
        }
    });
    return uniq(resolvedTypeDefinitions.map((x)=>x.trim()
    )).join('\n');
}
function uniq(array) {
    return array.reduce((accumulator, currentValue)=>accumulator.indexOf(currentValue) === -1 ? [
            ...accumulator,
            currentValue
        ] : accumulator
    , []);
}
function buildSchemaFromTypeDefinitions(typeDefinitions, parseOptions) {
    const document = buildDocumentFromTypeDefinitions(typeDefinitions, parseOptions);
    const typesAst = filterExtensionDefinitions(document);
    const backcompatOptions = {
        commentDescriptions: true
    };
    let schema = buildASTSchema(typesAst, backcompatOptions);
    const extensionsAst = extractExtensionDefinitions(document);
    if (extensionsAst.definitions.length > 0) {
        schema = extendSchema(schema, extensionsAst, backcompatOptions);
    }
    return schema;
}
function isDocumentNode(typeDefinitions) {
    return typeDefinitions.kind !== undefined;
}
function buildDocumentFromTypeDefinitions(typeDefinitions, parseOptions) {
    let document;
    if (typeof typeDefinitions === 'string') {
        document = parse1(typeDefinitions, parseOptions);
    } else if (Array.isArray(typeDefinitions)) {
        document = parse1(concatenateTypeDefs(typeDefinitions), parseOptions);
    } else if (isDocumentNode(typeDefinitions)) {
        document = typeDefinitions;
    } else {
        const type = typeof typeDefinitions;
        throw new Error(`typeDefs must be a string, array or schema AST, got ${type}`);
    }
    return document;
}
function decorateWithLogger(fn, logger, hint) {
    const resolver = fn != null ? fn : defaultFieldResolver;
    const logError = (e)=>{
        const newE = new Error();
        newE.stack = e.stack;
        if (hint) {
            newE['originalMessage'] = e.message;
            newE.message = `Error in resolver ${hint}\n${e.message}`;
        }
        logger.log(newE);
    };
    return (root, args, ctx, info)=>{
        try {
            const result = resolver(root, args, ctx, info);
            if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
                result.catch((reason)=>{
                    const error = reason instanceof Error ? reason : new Error(reason);
                    logError(error);
                    return reason;
                });
            }
            return result;
        } catch (e) {
            logError(e);
            throw e;
        }
    };
}
function addErrorLoggingToSchema(schema, logger) {
    if (!logger) {
        throw new Error('Must provide a logger');
    }
    if (typeof logger.log !== 'function') {
        throw new Error('Logger.log must be a function');
    }
    return mapSchema(schema, {
        [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName, typeName)=>({
                ...fieldConfig,
                resolve: decorateWithLogger(fieldConfig.resolve, logger, `${typeName}.${fieldName}`)
            })
    });
}
function decorateToCatchUndefined(fn, hint) {
    const resolve = fn == null ? defaultFieldResolver : fn;
    return (root, args, ctx, info)=>{
        const result = resolve(root, args, ctx, info);
        if (typeof result === 'undefined') {
            throw new Error(`Resolver for "${hint}" returned undefined`);
        }
        return result;
    };
}
function addCatchUndefinedToSchema(schema) {
    return mapSchema(schema, {
        [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName, typeName)=>({
                ...fieldConfig,
                resolve: decorateToCatchUndefined(fieldConfig.resolve, `${typeName}.${fieldName}`)
            })
    });
}
function makeExecutableSchema({ typeDefs: typeDefs2 , resolvers: resolvers5 = {} , logger , allowUndefinedInResolve =true , resolverValidationOptions ={} , directiveResolvers , schemaDirectives , schemaTransforms =[] , parseOptions ={} , inheritResolversFromInterfaces =false  }) {
    if (typeof resolverValidationOptions !== 'object') {
        throw new Error('Expected `resolverValidationOptions` to be an object');
    }
    if (!typeDefs2) {
        throw new Error('Must provide typeDefs');
    }
    const resolverMap = Array.isArray(resolvers5) ? resolvers5.reduce(mergeDeep, {}) : resolvers5;
    let schema = buildSchemaFromTypeDefinitions(typeDefs2, parseOptions);
    schema = addResolversToSchema({
        schema,
        resolvers: resolverMap,
        resolverValidationOptions,
        inheritResolversFromInterfaces
    });
    assertResolversPresent(schema, resolverValidationOptions);
    if (!allowUndefinedInResolve) {
        schema = addCatchUndefinedToSchema(schema);
    }
    if (logger != null) {
        schema = addErrorLoggingToSchema(schema, logger);
    }
    if (typeof resolvers5['__schema'] === 'function') {
        schema = addSchemaLevelResolver(schema, resolvers5['__schema']);
    }
    schemaTransforms.forEach((schemaTransform)=>{
        schema = schemaTransform(schema);
    });
    if (directiveResolvers != null) {
        schema = attachDirectiveResolvers(schema, directiveResolvers);
    }
    if (schemaDirectives != null) {
        SchemaDirectiveVisitor.visitSchemaDirectives(schema, schemaDirectives);
    }
    return schema;
}
const docCache = new Map();
const fragmentSourceMap = new Map();
let printFragmentWarnings = true;
let experimentalFragmentVariables = false;
function normalize(string) {
    return string.replace(/[\s,]+/g, ' ').trim();
}
function cacheKeyFromLoc(loc) {
    return normalize(loc.source.body.substring(loc.start, loc.end));
}
function processFragments(ast) {
    const seenKeys = new Set();
    const definitions = [];
    ast.definitions.forEach((fragmentDefinition)=>{
        if (fragmentDefinition.kind === 'FragmentDefinition') {
            const fragmentName = fragmentDefinition.name.value;
            const sourceKey = cacheKeyFromLoc(fragmentDefinition.loc);
            let sourceKeySet = fragmentSourceMap.get(fragmentName);
            if (sourceKeySet && !sourceKeySet.has(sourceKey)) {
                if (printFragmentWarnings) {
                    console.warn('Warning: fragment with name ' + fragmentName + ' already exists.\n' + 'graphql-tag enforces all fragment names across your application to be unique; read more about\n' + 'this in the docs: http://dev.apollodata.com/core/fragments.html#unique-names');
                }
            } else if (!sourceKeySet) {
                fragmentSourceMap.set(fragmentName, sourceKeySet = new Set());
            }
            sourceKeySet.add(sourceKey);
            if (!seenKeys.has(sourceKey)) {
                seenKeys.add(sourceKey);
                definitions.push(fragmentDefinition);
            }
        } else {
            definitions.push(fragmentDefinition);
        }
    });
    return {
        ...ast,
        definitions
    };
}
function stripLoc(doc) {
    const workSet = new Set(doc.definitions);
    workSet.forEach((node)=>{
        if (node.loc) delete node.loc;
        Object.keys(node).forEach((key)=>{
            const value = node[key];
            if (value && typeof value === 'object') {
                workSet.add(value);
            }
        });
    });
    const loc = doc.loc;
    if (loc) {
        delete loc.startToken;
        delete loc.endToken;
    }
    return doc;
}
function parseDocument(source) {
    var cacheKey = normalize(source);
    if (!docCache.has(cacheKey)) {
        const parsed = parse1(source, {
            experimentalFragmentVariables
        });
        if (!parsed || parsed.kind !== 'Document') {
            throw new Error('Not a valid GraphQL document.');
        }
        docCache.set(cacheKey, stripLoc(processFragments(parsed)));
    }
    return docCache.get(cacheKey);
}
function gql(literals, ...args) {
    if (typeof literals === 'string') {
        literals = [
            literals
        ];
    }
    let result = literals[0];
    args.forEach((arg, i)=>{
        if (arg && arg.kind === 'Document') {
            result += arg.loc.source.body;
        } else {
            result += arg;
        }
        result += literals[i + 1];
    });
    return parseDocument(result);
}
const typeDefs = gql`
  type Query {
    hello : String
  }
`;
const resolvers = {
    Query: {
        hello: ()=>Promise.resolve("Hello World!")
    }
};
const graphql1 = async (req)=>await GraphQLHTTP({
        schema: makeExecutableSchema({
            resolvers,
            typeDefs
        }),
        graphiql: true
    })(req)
;
serve((req)=>{
    const routes = {
        "/": serveStatic("./app/public/index.html", "text/html"),
        "/favicon.png": serveStatic("./app/public/favicon.png", "image/png"),
        "/hero.svg": serveStatic("./app/public/hero.svg", "image/svg+xml"),
        "/build/bundle.css": serveStatic("./app/public/build/bundle.css", "text/css"),
        "/build/bundle.js": serveStatic("./app/public/build/bundle.js", "text/javascript"),
        "/graphql": graphql1
    };
    const { pathname  } = new URL(req.url);
    console.log(`${req.method} ${pathname}`);
    return routes[pathname] ? routes[pathname](req) : routes["/"](req);
});
function serveStatic(file, type) {
    return async ()=>new Response(await Deno.readFile(file), {
            headers: {
                "content-type": type
            }
        })
    ;
}
