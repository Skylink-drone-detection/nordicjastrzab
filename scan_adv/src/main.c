#include <zephyr/types.h>
#include <stddef.h>
#include <string.h>
#include <math.h>
#include <zephyr/sys/printk.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/random/random.h>
#include <zephyr/kernel.h>

/* Configuration */
#define MAX_TARGETS       100
#define MAX_NAME_LEN      10
#define PURGE_TIMEOUT_MS  30000 
#define COMPANY_ID_CODE   0xFFFE 

/* Triangulation Constants */
#define BASELINE_DIST     2.0f   // Distance between L15 and 5340 in meters
#define REF_RSSI_1M       -55.0f // Measured RSSI at 1 meter
#define PATH_LOSS_EXP     3.0f   // Environment factor (2.0=air, 3.0=indoors)

struct ble_target {
    bt_addr_le_t addr;
    int8_t local_rssi;
    int8_t remote_rssi;
    char name[MAX_NAME_LEN + 1];
    uint32_t last_seen;
    bool active;
} __aligned(4);

struct remote_scan_report {
    uint16_t company_id;
    int8_t   remote_rssi;
    bt_addr_le_t target_addr;
} __packed;

static struct ble_target target_list[MAX_TARGETS];

/* --- Math Engine --- */
float rssi_to_meters(int8_t rssi) {
    if (rssi == 0) return 0.0f;
    return powf(10.0f, (float)(REF_RSSI_1M - rssi) / (10.0f * PATH_LOSS_EXP));
}

void get_coords(struct ble_target *t, float *x_out, float *y_out) {
    float r1 = rssi_to_meters(t->local_rssi);
    float r2 = rssi_to_meters(t->remote_rssi);
    float d  = BASELINE_DIST;

    *x_out = (powf(r1, 2) - powf(r2, 2) + powf(d, 2)) / (2.0f * d);
    float y_sq = powf(r1, 2) - powf(*x_out, 2);
    *y_out = (y_sq > 0) ? sqrtf(y_sq) : 0.0f;
}

/* --- Table Management --- */
void prune_old_targets(void) {
    uint32_t now = k_uptime_get_32();
    for (int i = 0; i < MAX_TARGETS; i++) {
        if (target_list[i].active && (now - target_list[i].last_seen > PURGE_TIMEOUT_MS)) {
            target_list[i].active = false;
        }
    }
}

static void update_target(const bt_addr_le_t *addr, int8_t rssi, const char *name, bool is_remote) {
    int empty_idx = -1;
    for (int i = 0; i < MAX_TARGETS; i++) {
        if (!target_list[i].active) {
            if (empty_idx == -1) empty_idx = i;
            continue;
        }
        if (bt_addr_le_cmp(&target_list[i].addr, addr) == 0) {
            if (is_remote) target_list[i].remote_rssi = rssi;
            else {
                target_list[i].local_rssi = rssi;
                if (name && name[0] != '\0') strncpy(target_list[i].name, name, MAX_NAME_LEN);
            }
            target_list[i].last_seen = k_uptime_get_32();
            return;
        }
    }
    if (empty_idx != -1) {
        target_list[empty_idx].active = true;
        bt_addr_le_copy(&target_list[empty_idx].addr, addr);
        target_list[empty_idx].local_rssi = is_remote ? 0 : rssi;
        target_list[empty_idx].remote_rssi = is_remote ? rssi : 0;
        target_list[empty_idx].last_seen = k_uptime_get_32();
        if (name && name[0] != '\0') strncpy(target_list[empty_idx].name, name, MAX_NAME_LEN);
        else strcpy(target_list[empty_idx].name, "N/A");
    }
}

/* --- Callbacks --- */
static bool data_cb(struct bt_data *data, void *user_data) {
    char *name_store = user_data;
    if (data->type == BT_DATA_MANUFACTURER_DATA && data->data_len == sizeof(struct remote_scan_report)) {
        struct remote_scan_report *report = (void *)data->data;
        if (report->company_id == COMPANY_ID_CODE) {
            update_target(&report->target_addr, report->remote_rssi, NULL, true);
        }
    } else if (data->type == BT_DATA_NAME_SHORTENED || data->type == BT_DATA_NAME_COMPLETE) {
        int len = MIN(data->data_len, MAX_NAME_LEN);
        memcpy(name_store, data->data, len);
        name_store[len] = '\0';
    }
    return true;
}

static void scan_cb(const bt_addr_le_t *addr, int8_t rssi, uint8_t adv_type, struct net_buf_simple *buf) {
    char local_name[MAX_NAME_LEN + 1] = {0};
    bt_data_parse(buf, data_cb, local_name);
    update_target(addr, rssi, local_name, false);
}

int main(void) {
    struct bt_le_scan_param scan_param = {
        .type = BT_LE_SCAN_TYPE_PASSIVE,
        .interval = BT_GAP_SCAN_FAST_INTERVAL,
        .window = BT_GAP_SCAN_FAST_WINDOW,
    };
    uint8_t mfg_data_raw[] = { 0xff, 0xff, 0x00 };
    struct bt_data ad_data[] = { BT_DATA(BT_DATA_MANUFACTURER_DATA, mfg_data_raw, 3) };

    memset(target_list, 0, sizeof(target_list));
    if (bt_enable(NULL)) return 0;
    printk("nRF54L15: Collector Online\n");

    while (1) {
        prune_old_targets();

        if (!bt_le_scan_start(&scan_param, scan_cb)) {
            k_sleep(K_SECONDS(2)); 
            bt_le_scan_stop();
        }

        bt_le_adv_start(BT_LE_ADV_NCONN, ad_data, ARRAY_SIZE(ad_data), NULL, 0);
        k_sleep(K_MSEC(100)); 
        bt_le_adv_stop();
        
        k_sleep(K_MSEC(sys_rand32_get() % 100));

        /* Output for Python bridge_uart.py */
        for (int i = 0; i < MAX_TARGETS; i++) {
            if (target_list[i].active && target_list[i].local_rssi != 0 && target_list[i].remote_rssi != 0 && target_list[i].remote_rssi > -55) {
                float x, y;
                get_coords(&target_list[i], &x, &y);
                
                /* * Format: position,x,y,name,target_name
                 * This matches parse_nrf_line(line) in bridge_uart.py 
                 */
                printk("position,%.4f,%.4f,name,%s\n", (double)x, (double)y, target_list[i].name);
            }
        }
    }
    return 0;
}