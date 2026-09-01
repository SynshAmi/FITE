package me.desair.spring.transfer;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.TestPropertySource;
import java.time.Instant;
import me.desair.spring.transfer.domain.TransferStatus;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:testdb;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver",
    "spring.datasource.username=sa",
    "spring.datasource.password=",
    "spring.jpa.hibernate.ddl-auto=validate",
    "spring.flyway.enabled=true"
})
public class TransferPersistenceIntegrationTest {

    @Autowired
    private TransferRepository transferRepository;

    @Autowired
    private TransferChunkRepository chunkRepository;

    @Test
    public void testUniqueConstraintPreventsDuplicateChunks() {
        TransferEntity transfer = new TransferEntity();
        transfer.setTransferId("tf_123");
        transfer.setShareToken("st_123");
        transfer.setFileName("test.txt");
        transfer.setFileSize(100);
        transfer.setChunkSize(10);
        transfer.setTotalChunks(10);
        transfer.setStatus(TransferStatus.CREATED);
        transfer.setCreatedAt(Instant.now());
        transfer.setExpiresAt(Instant.now().plusSeconds(3600));
        
        transferRepository.saveAndFlush(transfer);

        TransferChunkEntity chunk1 = new TransferChunkEntity();
        chunk1.setTransferId("tf_123");
        chunk1.setChunkIndex(0);
        chunk1.setSize(10);
        chunk1.setChecksum("abc");
        chunk1.setUploadedAt(Instant.now());
        chunkRepository.saveAndFlush(chunk1);

        TransferChunkEntity chunk2 = new TransferChunkEntity();
        chunk2.setTransferId("tf_123");
        chunk2.setChunkIndex(0); // Duplicate chunk index
        chunk2.setSize(10);
        chunk2.setChecksum("def");
        chunk2.setUploadedAt(Instant.now());
        
        assertThrows(DataIntegrityViolationException.class, () -> {
            chunkRepository.saveAndFlush(chunk2);
        });
    }

    @Test
    public void testForeignKeyCascadesDelete() {
        TransferEntity transfer = new TransferEntity();
        transfer.setTransferId("tf_456");
        transfer.setShareToken("st_456");
        transfer.setFileName("test2.txt");
        transfer.setFileSize(100);
        transfer.setChunkSize(10);
        transfer.setTotalChunks(10);
        transfer.setStatus(TransferStatus.CREATED);
        transfer.setCreatedAt(Instant.now());
        transfer.setExpiresAt(Instant.now().plusSeconds(3600));
        
        transferRepository.saveAndFlush(transfer);

        TransferChunkEntity chunk1 = new TransferChunkEntity();
        chunk1.setTransferId("tf_456");
        chunk1.setChunkIndex(0);
        chunk1.setSize(10);
        chunk1.setChecksum("abc");
        chunk1.setUploadedAt(Instant.now());
        chunkRepository.saveAndFlush(chunk1);

        assertEquals(1, chunkRepository.findByTransferIdOrderByChunkIndexAsc("tf_456").size());

        transferRepository.deleteById("tf_456");
        transferRepository.flush();

        assertEquals(0, chunkRepository.findByTransferIdOrderByChunkIndexAsc("tf_456").size());
    }
}
