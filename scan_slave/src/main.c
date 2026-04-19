#include <zephyr/types.h>
#include <stddef.h>
#include <string.h>
#include <zephyr/sys/printk.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/random/random.h>
#include <zephyr/kernel.h>


#define COMPANY_ID_CODE 0xFFFE  /* Must match the nRF54L15 code */

/* 1. This structure MUST match the nRF54L15 exactly */
struct remote_scan_report {
    uint16_t company_id;
    int8_t   remote_rssi;      
    bt_addr_le_t target_addr;  
} __packed;

static struct remote_scan_report current_report;
static bool target_found = false;

/* 2. Scan Callback: Capture the target device's info */
static void scan_cb(const bt_addr_le_t *addr, int8_t rssi, uint8_t adv_type,
                    struct net_buf_simple *buf)
{
    /* Filter: Ignore very weak signals */
    if (rssi < -85) return;

    /* Save the data to our report structure */
    current_report.company_id = COMPANY_ID_CODE;
    current_report.remote_rssi = rssi;
    bt_addr_le_copy(&current_report.target_addr, addr);
    
    target_found = true;

    char addr_str[BT_ADDR_LE_STR_LEN];
    bt_addr_le_to_str(addr, addr_str, sizeof(addr_str));
    printk("Found Target: %s (RSSI: %d)\n", addr_str, rssi);
}

	int main(void)
	{
		int err;
		struct bt_le_scan_param scan_param = {
			.type       = BT_LE_SCAN_TYPE_PASSIVE,
			.options    = BT_LE_SCAN_OPT_NONE,
			.interval   = BT_GAP_SCAN_FAST_INTERVAL,
			.window     = BT_GAP_SCAN_FAST_WINDOW,
		};

		printk("nRF5340: Reporting Node Started\n");

		err = bt_enable(NULL);
		if (err) {
			printk("Bluetooth init failed (err %d)\n", err);
			return 0;
		}

	while (1) {
		/* PHASE 1: SCAN (Reduced to 500ms to find targets faster) */
		target_found = false;
		err = bt_le_scan_start(&scan_param, scan_cb);
		if (!err) {
			k_sleep(K_MSEC(500)); 
			bt_le_scan_stop();
		}

		/* PHASE 2: REPORT (Broadcast to L15) */
		if (target_found) {
			struct bt_data ad[] = {
				BT_DATA(BT_DATA_MANUFACTURER_DATA, &current_report, sizeof(current_report)),
			};

			/* Advertise for 800ms to increase the chance L15 catches it */
			bt_le_adv_start(BT_LE_ADV_NCONN, ad, ARRAY_SIZE(ad), NULL, 0);
			k_sleep(K_MSEC(800));
			bt_le_adv_stop();
		}

		/* PHASE 3: JITTER (The most important part) */
		/* Adds a random delay between 10ms and 300ms so we don't sync with L15 */
		uint32_t jitter = (sys_rand32_get() % 290) + 10;
		k_sleep(K_MSEC(jitter));
	}
    return 0;
}