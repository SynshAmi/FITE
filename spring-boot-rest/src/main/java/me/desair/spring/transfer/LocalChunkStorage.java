package me.desair.spring.transfer;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.io.InputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import org.springframework.util.FileSystemUtils;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import java.nio.file.NoSuchFileException;

@Service
@ConditionalOnProperty(name = "storage.type", havingValue = "local", matchIfMissing = true)
public class LocalChunkStorage implements ChunkStorage {

    private final Path baseDir;

    public LocalChunkStorage(@Value("${storage.local.directory}") String storageDir) throws IOException {
        this.baseDir = Paths.get(storageDir).normalize().toAbsolutePath();
        Files.createDirectories(this.baseDir);
    }

    private Path getChunkPath(String transferId, int chunkIndex) {
        if (transferId == null || transferId.isBlank() || transferId.contains("..") || transferId.contains("/") || transferId.contains("\\")) {
            throw new StorageException("Invalid transferId for storage operations");
        }
        if (chunkIndex < 0) {
            throw new StorageException("Chunk index cannot be negative");
        }
        Path path = baseDir.resolve(transferId).resolve("chunks").resolve(String.format("%06d", chunkIndex)).normalize().toAbsolutePath();
        if (!path.startsWith(baseDir)) {
            throw new StorageException("Path traversal attempt detected");
        }
        return path;
    }

    @Override
    public void putChunk(String transferId, int chunkIndex, InputStream data, long size) throws Exception {
        Path chunkPath = getChunkPath(transferId, chunkIndex);
        try {
            Files.createDirectories(chunkPath.getParent());
            Files.copy(data, chunkPath, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            throw new StorageException("Failed to store chunk " + chunkIndex + " for transfer " + transferId, e);
        }
    }

    @Override
    public InputStream getChunk(String transferId, int chunkIndex) throws Exception {
        Path chunkPath = getChunkPath(transferId, chunkIndex);
        try {
            return Files.newInputStream(chunkPath);
        } catch (NoSuchFileException e) {
            throw new StorageFileNotFoundException("Chunk file missing: " + chunkPath, e);
        } catch (IOException e) {
            throw new StorageException("Failed to read chunk " + chunkIndex + " for transfer " + transferId, e);
        }
    }

    @Override
    public boolean exists(String transferId, int chunkIndex) {
        return Files.exists(getChunkPath(transferId, chunkIndex));
    }

    @Override
    public void deleteChunk(String transferId, int chunkIndex) throws Exception {
        Path chunkPath = getChunkPath(transferId, chunkIndex);
        try {
            Files.deleteIfExists(chunkPath);
        } catch (IOException e) {
            throw new StorageException("Failed to delete chunk " + chunkIndex + " for transfer " + transferId, e);
        }
    }

    @Override
    public void deleteTransfer(String transferId) throws Exception {
        if (transferId == null || transferId.isBlank() || transferId.contains("..") || transferId.contains("/") || transferId.contains("\\")) {
            throw new StorageException("Invalid transferId for storage operations");
        }
        Path transferDir = baseDir.resolve(transferId).normalize().toAbsolutePath();
        if (!transferDir.startsWith(baseDir)) {
            throw new StorageException("Path traversal attempt detected");
        }
        try {
            FileSystemUtils.deleteRecursively(transferDir);
        } catch (IOException e) {
            throw new StorageException("Failed to delete transfer directory " + transferId, e);
        }
    }
}
