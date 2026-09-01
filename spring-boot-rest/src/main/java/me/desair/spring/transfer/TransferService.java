package me.desair.spring.transfer;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import me.desair.spring.transfer.domain.Transfer;
import me.desair.spring.transfer.domain.TransferChunk;
import java.time.Instant;
import java.util.Optional;
import java.util.List;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.DigestInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HexFormat;
import java.io.FileInputStream;

@Service
public class TransferService {

    private final TransferRepository transferRepository;
    private final TransferChunkRepository chunkRepository;
    private final ChunkStorage chunkStorage;
    private final long defaultChunkSize;

    public TransferService(TransferRepository transferRepository, 
                           TransferChunkRepository chunkRepository, 
                           ChunkStorage chunkStorage,
                           @org.springframework.beans.factory.annotation.Value("${transfer.chunk-size-bytes:8388608}") long defaultChunkSize) {
        this.transferRepository = transferRepository;
        this.chunkRepository = chunkRepository;
        this.chunkStorage = chunkStorage;
        this.defaultChunkSize = defaultChunkSize;
    }

    private Transfer toDomain(TransferEntity entity) {
        Transfer domain = new Transfer(
            entity.getTransferId(), entity.getShareToken(), entity.getFileName(),
            entity.getContentType(), entity.getFileSize(), entity.getChunkSize(),
            entity.getTotalChunks(), entity.getStatus(), entity.getCreatedAt(), entity.getExpiresAt()
        );
        chunkRepository.findByTransferIdOrderByChunkIndexAsc(entity.getTransferId()).forEach(chunkEntity -> {
            domain.loadExistingChunk(new TransferChunk(
                chunkEntity.getChunkIndex(), chunkEntity.getSize(),
                chunkEntity.getChecksum(), chunkEntity.getUploadedAt()
            ));
        });
        return domain;
    }

    private void saveDomain(Transfer domain) {
        TransferEntity entity = transferRepository.findById(domain.getId()).orElseGet(TransferEntity::new);
        entity.setTransferId(domain.getId());
        entity.setShareToken(domain.getShareToken());
        entity.setFileName(domain.getFileName());
        entity.setContentType(domain.getContentType());
        entity.setFileSize(domain.getFileSize());
        entity.setChunkSize(domain.getChunkSize());
        entity.setTotalChunks(domain.getTotalChunks());
        entity.setStatus(domain.getStatus());
        entity.setCreatedAt(domain.getCreatedAt());
        entity.setExpiresAt(domain.getExpiresAt());
        transferRepository.save(entity);
        
        domain.getAvailableChunkIndexes().forEach(index -> {
            Optional<TransferChunkEntity> existing = chunkRepository.findByTransferIdAndChunkIndex(domain.getId(), index);
            if (existing.isEmpty()) {
                TransferChunk c = domain.getChunk(index);
                TransferChunkEntity ce = new TransferChunkEntity();
                ce.setTransferId(domain.getId());
                ce.setChunkIndex(c.getIndex());
                ce.setSize(c.getSize());
                ce.setChecksum(c.getChecksum());
                ce.setUploadedAt(c.getUploadedAt());
                chunkRepository.save(ce);
            }
        });
    }

    @Transactional
    public TransferEntity createTransfer(String fileName, long fileSize, String contentType) {
        Transfer domain = Transfer.createNew(fileName, fileSize, contentType, defaultChunkSize);
        saveDomain(domain);
        return transferRepository.findById(domain.getId()).get();
    }

    public TransferEntity getTransfer(String transferId, String token) {
        TransferEntity entity = transferRepository.findById(transferId)
            .orElseThrow(() -> new TransferNotFoundException("Transfer not found"));
        Transfer domain = toDomain(entity);
        domain.checkAccess(token, Instant.now());
        return entity;
    }

    public List<Integer> getAvailableChunks(String transferId, String token) {
        TransferEntity entity = transferRepository.findById(transferId)
            .orElseThrow(() -> new TransferNotFoundException("Transfer not found"));
        Transfer domain = toDomain(entity);
        domain.checkAccess(token, Instant.now());
        return domain.getAvailableChunkIndexes().stream().toList();
    }

    @Transactional
    public void uploadChunk(String transferId, int chunkIndex, String expectedChecksum, InputStream data, long size) throws Exception {
        TransferEntity entity = transferRepository.findById(transferId)
            .orElseThrow(() -> new IllegalArgumentException("Transfer not found"));
            
        Transfer domain = toDomain(entity);
        
        // 2. Validate transfer
        domain.checkUploadAllowed(Instant.now());
        
        // 3. Validate chunk index & Expected size
        long expectedSize = domain.getExpectedChunkSize(chunkIndex);
        
        // 1. Receive bytes and calculate checksum
        Path tempFile = Files.createTempFile("chunk-", ".tmp");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long receivedSize = 0;
            try (DigestInputStream dis = new DigestInputStream(data, digest)) {
                receivedSize = Files.copy(dis, tempFile, StandardCopyOption.REPLACE_EXISTING);
            }
            
            // 4. Validate expected chunk size
            if (receivedSize != expectedSize) {
                throw new IllegalArgumentException("Invalid chunk size. Expected " + expectedSize + " but got " + receivedSize);
            }
            
            String calculatedChecksum = HexFormat.of().formatHex(digest.digest());
            
            // 5. Validate checksum (if client provided one)
            if (expectedChecksum != null && !calculatedChecksum.equalsIgnoreCase(expectedChecksum)) {
                throw new IllegalArgumentException("Checksum mismatch");
            }

            // Check Idempotency based on calculated checksum vs existing
            if (domain.getAvailableChunkIndexes().contains(chunkIndex)) {
                TransferChunk existing = domain.getChunk(chunkIndex);
                if (!existing.getChecksum().equalsIgnoreCase(calculatedChecksum)) {
                    throw new IllegalStateException("Chunk already exists with different content");
                }
                // Identical retry => deterministic idempotent success
                return;
            }

            // 6. Persist bytes
            try (InputStream is = new FileInputStream(tempFile.toFile())) {
                chunkStorage.putChunk(transferId, chunkIndex, is, receivedSize);
            }

            // 7. & 8. Mark AVAILABLE and Persist metadata transactionally
            TransferChunk newChunk = new TransferChunk(chunkIndex, receivedSize, calculatedChecksum, Instant.now());
            domain.markChunkAvailable(newChunk, Instant.now());
            
            // DB uniqueness constraint handles concurrent identical/conflicting writes
            saveDomain(domain);

        } finally {
            Files.deleteIfExists(tempFile);
        }
    }

    public TransferChunkEntity getChunkInfo(String transferId, int chunkIndex, String token) {
        TransferEntity entity = transferRepository.findById(transferId)
            .orElseThrow(() -> new TransferNotFoundException("Transfer not found"));
        Transfer domain = toDomain(entity);
        domain.checkAccess(token, Instant.now());
        
        if (!domain.getAvailableChunkIndexes().contains(chunkIndex)) {
            throw new ChunkNotAvailableException("Chunk " + chunkIndex + " is not available");
        }
        
        return chunkRepository.findByTransferIdAndChunkIndex(transferId, chunkIndex)
            .orElseThrow(() -> new ChunkNotAvailableException("Chunk metadata missing"));
    }

    public InputStream getChunkStream(String transferId, int chunkIndex, String token) throws Exception {
        getChunkInfo(transferId, chunkIndex, token); // Validates existence and access
        return chunkStorage.getChunk(transferId, chunkIndex);
    }

    @Transactional
    public void completeTransfer(String transferId) {
        TransferEntity entity = transferRepository.findById(transferId)
            .orElseThrow(() -> new IllegalArgumentException("Transfer not found"));
            
        Transfer domain = toDomain(entity);
        domain.complete(Instant.now());
        saveDomain(domain);
    }
}
