// Taken from TorControlPort.sys.mjs

/**
 * A wrapper around XPCOM sockets and buffers to handle streams in a standard
 * async JS fashion.
 * This class can handle both Unix sockets and TCP sockets.
 */
export class AsyncSocket {
  /**
   * The output stream used for write operations.
   *
   * @type {nsIAsyncOutputStream}
   */
  #outputStream;
  /**
   * The output stream can only have one registered callback at a time, so
   * multiple writes need to be queued up (see nsIAsyncOutputStream.idl).
   * Every item is associated with a promise we returned in write, and it will
   * resolve it or reject it when called by the output stream.
   *
   * @type {nsIOutputStreamCallback[]}
   */
  #outputQueue = [];
  /**
   * The input stream.
   *
   * @type {nsIAsyncInputStream}
   */
  #inputStream;
  /**
   * An input stream adapter that makes reading from scripts easier.
   *
   * @type {nsIScriptableInputStream}
   */
  #scriptableInputStream;
  /**
   * The queue of callbacks to be used when we receive data.
   * Every item is associated with a promise we returned in read, and it will
   * resolve it or reject it when called by the input stream.
   *
   * @type {nsIInputStreamCallback[]}
   */
  #inputQueue = [];

  /**
   * Connect to a Unix socket. Not available on Windows.
   *
   * @param {nsIFile} ipcFile The path to the Unix socket to connect to.
   * @returns {AsyncSocket}
   */
  static fromIpcFile(ipcFile) {
    const sts = Cc[
      "@mozilla.org/network/socket-transport-service;1"
    ].getService(Ci.nsISocketTransportService);
    const socket = new AsyncSocket();
    const transport = sts.createUnixDomainTransport(ipcFile);
    socket.#createStreams(transport);
    return socket;
  }

  /**
   * Connect to a TCP socket.
   *
   * @param {string} host The hostname to connect the TCP socket to.
   * @param {number} port The port to connect the TCP socket to.
   * @returns {AsyncSocket}
   */
  static fromSocketAddress(host, port) {
    const sts = Cc[
      "@mozilla.org/network/socket-transport-service;1"
    ].getService(Ci.nsISocketTransportService);
    const socket = new AsyncSocket();
    const transport = sts.createTransport([], host, port, null, null);
    socket.#createStreams(transport);
    return socket;
  }

  #createStreams(socketTransport) {
    const OPEN_UNBUFFERED = Ci.nsITransport.OPEN_UNBUFFERED;
    this.#outputStream = socketTransport
      .openOutputStream(OPEN_UNBUFFERED, 1, 1)
      .QueryInterface(Ci.nsIAsyncOutputStream);

    this.#inputStream = socketTransport
      .openInputStream(OPEN_UNBUFFERED, 1, 1)
      .QueryInterface(Ci.nsIAsyncInputStream);
    this.#scriptableInputStream = Cc[
      "@mozilla.org/scriptableinputstream;1"
    ].createInstance(Ci.nsIScriptableInputStream);
    this.#scriptableInputStream.init(this.#inputStream);
  }

  /**
   * Asynchronously write string to underlying socket.
   *
   * When write is called, we create a new promise and queue it on the output
   * queue. If it is the only element in the queue, we ask the output stream to
   * run it immediately.
   * Otherwise, the previous item of the queue will run it after it finishes.
   *
   * @param {string} str The string to write to the socket. The underlying
   * implementation should convert JS strings (UTF-16) into UTF-8 strings.
   * See also write nsIOutputStream (the first argument is a string, not a
   * wstring).
   * @returns {Promise<number>} The number of written bytes
   */
  async write(str) {
    return new Promise((resolve, reject) => {
      // Asynchronously wait for the stream to be writable (or closed) if we
      // have any pending requests.
      const tryAsyncWait = () => {
        if (this.#outputQueue.length) {
          this.#outputStream.asyncWait(
            this.#outputQueue.at(0), // next request
            0,
            0,
            Services.tm.currentThread
          );
        }
      };

      // Implement an nsIOutputStreamCallback: write the string once possible,
      // and then start running the following queue item, if any.
      this.#outputQueue.push({
        onOutputStreamReady: () => {
          try {
            const bytesWritten = this.#outputStream.write(str, str.length);

            // Remove this callback object from queue, as it is now completed.
            this.#outputQueue.shift();

            // Queue the next request if there is one.
            tryAsyncWait();

            // Finally, resolve the promise.
            resolve(bytesWritten);
          } catch (err) {
            // Reject the promise on error.
            reject(err);
          }
        },
      });

      // Length 1 imples that there is no in-flight asyncWait, so we may
      // immediately follow through on this write.
      if (this.#outputQueue.length === 1) {
        tryAsyncWait();
      }
    });
  }

  /**
   * Asynchronously read string from underlying socket and return it.
   *
   * When read is called, we create a new promise and queue it on the input
   * queue. If it is the only element in the queue, we ask the input stream to
   * run it immediately.
   * Otherwise, the previous item of the queue will run it after it finishes.
   *
   * This function is expected to throw when the underlying socket has been
   * closed.
   *
   * @returns {Promise<string>} The read string
   */
  async read() {
    return new Promise((resolve, reject) => {
      const tryAsyncWait = () => {
        if (this.#inputQueue.length) {
          this.#inputStream.asyncWait(
            this.#inputQueue.at(0), // next input request
            0,
            0,
            Services.tm.currentThread
          );
        }
      };

      this.#inputQueue.push({
        onInputStreamReady: () => {
          try {
            if (!this.#scriptableInputStream.available()) {
              // This means EOF, but not closed yet. However, arriving at EOF
              // should be an error condition for us, since we are in a socket,
              // and EOF should mean peer disconnected.
              // If the stream has been closed, this function itself should
              // throw.
              reject(
                new Error("onInputStreamReady called without available bytes.")
              );
              return;
            }

            // Read our string from input stream.
            const str = this.#scriptableInputStream.read(
              this.#scriptableInputStream.available()
            );

            // Remove this callback object from queue now that we have read.
            this.#inputQueue.shift();

            // Start waiting for incoming data again if the reading queue is not
            // empty.
            tryAsyncWait();

            // Finally resolve the promise.
            resolve(str);
          } catch (err) {
            // E.g., we received a NS_BASE_STREAM_CLOSED because the socket was
            // closed.
            reject(err);
          }
        },
      });

      // Length 1 imples that there is no in-flight asyncWait, so we may
      // immediately follow through on this read.
      if (this.#inputQueue.length === 1) {
        tryAsyncWait();
      }
    });
  }

  /**
   * Close the streams.
   */
  close() {
    this.#outputStream.close();
    this.#inputStream.close();
  }
}
