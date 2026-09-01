package me.desair.spring.transfer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;

@SpringBootTest(properties = {
    "storage.type=local",
    "storage.local.directory=target/test-security-storage",
    "cors.allowed-origins=http://localhost:5173"
})
@AutoConfigureMockMvc
public class SecurityIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void testCorsHeaders() throws Exception {
        mockMvc.perform(post("/api/transfers")
                .header("Origin", "http://localhost:5173")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fileName\":\"test.txt\",\"fileSize\":1024,\"contentType\":\"text/plain\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
    }

    @Test
    void testRateLimitingOnCreationEndpoint() throws Exception {
        // Create endpoint allows 5 per minute.
        // We will loop 6 times using a spoofed IP to guarantee we hit the limit without affecting other tests.
        String spoofedIp = "192.168.1.100";

        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/transfers")
                    .header("X-Forwarded-For", spoofedIp)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"fileName\":\"rate_test_" + i + ".txt\",\"fileSize\":1024}"))
                    .andExpect(status().isOk());
        }

        // 6th request should fail
        mockMvc.perform(post("/api/transfers")
                .header("X-Forwarded-For", spoofedIp)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fileName\":\"rate_test_too_many.txt\",\"fileSize\":1024}"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void testMaxFileSizeValidation() throws Exception {
        CreateTransferRequest req = new CreateTransferRequest();
        req.setFileName("too_big.txt");
        req.setFileSize(60000000000L); // 60GB, limit is 50GB

        mockMvc.perform(post("/api/transfers")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest()); // Should fail validation
    }
}
