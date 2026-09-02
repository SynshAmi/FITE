package me.desair.spring.transfer;

import me.desair.spring.transfer.infrastructure.storage.LocalChunkStorage;
import me.desair.spring.transfer.infrastructure.storage.StorageException;
import me.desair.spring.transfer.infrastructure.storage.StorageFileNotFoundException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.util.FileSystemUtils;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class LocalChunkStorageTest {

    private Path tempDir;
    private LocalChunkStorage storage;

    @BeforeEach
    void setUp() throws Exception {
        tempDir = Files.createTempDirectory("chunk-storage-test");
        storage = new LocalChunkStorage(tempDir.toString());
    }

    @AfterEach
    void tearDown() throws Exception {
        FileSystemUtils.deleteRecursively(tempDir);
    }

    @Test
    void testPutAndGetChunk() throws Exception {
        String transferId = "tf_123";
        int chunkIndex = 0;
        byte[] data = "Hello Chunk".getBytes();

        assertFalse(storage.exists(transferId, chunkIndex));

        storage.putChunk(transferId, chunkIndex, new ByteArrayInputStream(data), data.length);

        assertTrue(storage.exists(transferId, chunkIndex));

        try (InputStream is = storage.getChunk(transferId, chunkIndex)) {
            assertArrayEquals(data, is.readAllBytes());
        }
    }

    @Test
    void testGetMissingChunkThrowsStorageFileNotFound() {
        assertThrows(StorageFileNotFoundException.class, () -> storage.getChunk("tf_missing", 0));
    }

    @Test
    void testDeleteChunkIsIdempotent() throws Exception {
        String transferId = "tf_del";
        int chunkIndex = 1;
        
        // Deleting non-existent chunk should not throw
        assertDoesNotThrow(() -> storage.deleteChunk(transferId, chunkIndex));

        byte[] data = "Data".getBytes();
        storage.putChunk(transferId, chunkIndex, new ByteArrayInputStream(data), data.length);
        
        assertTrue(storage.exists(transferId, chunkIndex));
        
        storage.deleteChunk(transferId, chunkIndex);
        
        assertFalse(storage.exists(transferId, chunkIndex));
        
        // Second delete should also not throw
        assertDoesNotThrow(() -> storage.deleteChunk(transferId, chunkIndex));
    }

    @Test
    void testDeleteTransfer() throws Exception {
        String transferId = "tf_multi";
        byte[] data = "Data".getBytes();
        
        storage.putChunk(transferId, 0, new ByteArrayInputStream(data), data.length);
        storage.putChunk(transferId, 1, new ByteArrayInputStream(data), data.length);
        
        assertTrue(storage.exists(transferId, 0));
        assertTrue(storage.exists(transferId, 1));
        
        storage.deleteTransfer(transferId);
        
        assertFalse(storage.exists(transferId, 0));
        assertFalse(storage.exists(transferId, 1));
        
        // Idempotent
        assertDoesNotThrow(() -> storage.deleteTransfer(transferId));
    }

    @Test
    void testPathTraversalPrevention() {
        String badTransferId = "../../../windows/system32";
        byte[] data = "Data".getBytes();
        
        StorageException e1 = assertThrows(StorageException.class, () ->
            storage.putChunk(badTransferId, 0, new ByteArrayInputStream(data), data.length));
        assertTrue(e1.getMessage().contains("Invalid transferId"));
        
        StorageException e2 = assertThrows(StorageException.class, () -> 
            storage.deleteTransfer(badTransferId));
        assertTrue(e2.getMessage().contains("Invalid transferId"));
    }

    @Test
    void testNegativeChunkIndex() {
        String transferId = "tf_valid";
        byte[] data = "Data".getBytes();
        
        StorageException e = assertThrows(StorageException.class, () -> 
            storage.putChunk(transferId, -1, new ByteArrayInputStream(data), data.length));
        assertTrue(e.getMessage().contains("Chunk index cannot be negative"));
    }
}
