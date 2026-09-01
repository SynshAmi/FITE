package me.desair.spring.transfer;

import java.io.InputStream;

public interface ChunkStorage {
    void putChunk(String transferId, int chunkIndex, InputStream data, long size) throws Exception;
    InputStream getChunk(String transferId, int chunkIndex) throws Exception;
    boolean exists(String transferId, int chunkIndex);
    void deleteChunk(String transferId, int chunkIndex) throws Exception;
    void deleteTransfer(String transferId) throws Exception;
}
