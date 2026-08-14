# Prompt thiết kế UI/UX Front-end – Website Thương mại điện tử ngành Thực phẩm/Tạp hoá

> Bản tổng hợp & nâng cấp, đúc kết từ 2 tham khảo: video demo "Gromuse" (grocery e-commerce UI kit) và ảnh giao diện "Grocery Bazar". Dùng làm brief đầy đủ cho designer hoặc prompt cho công cụ AI tạo giao diện — đã gộp phần mạnh của cả hai, bổ sung các phần còn thiếu (footer, testimonial, header 2 tầng, hero đa banner).

## 1. Tổng quan phong cách

- Phong cách: Clean, hiện đại, thân thiện, tối ưu cho ngành thực phẩm/tạp hoá/nguyên liệu pha chế.
- Bo góc lớn (rounded-2xl/3xl) ở hầu hết khối: card, banner, nút bấm, ảnh sản phẩm.
- Nhiều khoảng trắng, bố cục dạng lưới rõ ràng, dễ quét mắt.
- Xen kẽ nền màu theo từng section (kem/trắng ngà – đỏ đô đậm – pastel ấm) để tạo nhịp điệu khi cuộn trang.
- Tông màu thương hiệu: **đỏ đô (maroon) làm primary, vàng gold làm accent/CTA** — sang trọng, ấm áp, nổi bật nút hành động trên nền đậm. Xem bảng màu đầy đủ ở mục 2.

## 2. Bảng màu (Color Palette)

Bảng màu đề xuất — đỏ đô làm chủ đạo, vàng làm điểm nhấn hành động (CTA), giữ tông ấm xuyên suốt (tránh pha xanh/mint lạnh vốn hợp ngành rau củ hơn là trà & bánh):

| Vai trò | Màu đề xuất | Ghi chú sử dụng |
|---|---|---|
| Primary (thương hiệu) | Đỏ đô đậm `#6B1420` | Header, hero banner, text tiêu đề, nền khối lớn |
| Primary – tối hơn | Đỏ đô rất đậm `#4A0E16` | Hover/pressed state của khối primary, banner đặc biệt |
| Primary – nhạt hơn | Đỏ đô nhạt `#8C2430` | Chip/tag phụ trên nền trắng |
| Accent / CTA | Vàng gold `#F0B429` | Nút "Mua ngay", "Xem tất cả", badge số lượng, sao đánh giá |
| Accent – hover | Vàng đậm `#D89A00` | Trạng thái hover/pressed của nút vàng |
| Nền phụ 1 | Kem/trắng ngà `#FFF8ED` | Nền section xen kẽ, nền trang mặc định |
| Nền phụ 2 (pastel ấm) | Be ấm `#F5E6D3`, hồng đào nhạt `#F7DCD4`, vàng kem `#FBEFD0` | Nền category card, banner khuyến mãi nhỏ |
| Text chính | Nâu đen ấm `#2B0A0E` | Tiêu đề, giá tiền |
| Text phụ | Xám nâu ấm `#7A6A62` | Mô tả, thông tin phụ |
| Trạng thái khuyến mãi | Cam đất `#C9762E` | Badge giảm giá — tách biệt với đỏ đô primary để dễ đọc |
| Footer | Đỏ đô gần đen `#250608` | Nền footer, chữ trắng/kem nhạt `#FFF8ED` |

## 3. Typography — Font cho tiếng Việt

Ưu tiên font sans-serif hỗ trợ đầy đủ dấu tiếng Việt (thanh điệu, ư/ơ/đ...), không bị lỗi/thiếu dấu:

| Vai trò | Font đề xuất | Lý do |
|---|---|---|
| Chính (heading + body) | **Be Vietnam Pro** | Font Google Fonts thiết kế riêng cho tiếng Việt, dải weight 100–900 đầy đủ, dáng bo tròn hiện đại hợp phong cách F&B |
| Thay thế 1 | **Inter** | Hỗ trợ tiếng Việt tốt, trung tính, rất dễ đọc ở cỡ nhỏ (mô tả, bảng giá) |
| Thay thế 2 | **Mulish** hoặc **Sen** | Sen là font Việt hoá, nét mềm mại; Mulish gọn nhẹ, hợp UI thương mại điện tử |
| Điểm nhấn cao cấp (tuỳ chọn) | **Playfair Display** (serif, hỗ trợ dấu tiếng Việt) | Dùng cho logo/tiêu đề hero nếu muốn cảm giác sang trọng, thủ công — phối cùng Be Vietnam Pro cho phần còn lại |

- Heading: Bold, cỡ lớn (32–40px cho H1, 24–28px cho H2 section, căn giữa cho tiêu đề section như "Best Selling Products", "Shop By Category").
- Giá tiền: số lớn, đậm; có thể dùng kiểu phần thập phân nhỏ hơn nằm trên (superscript) như `17.²⁹đ`.
- Line-height thoáng (1.4–1.6), nhãn phụ/tag pill dùng chữ nhỏ, có thể uppercase nhẹ letter-spacing rộng.

## 4. Header

Gộp 2 kiểu, chọn 1 tuỳ độ phức tạp menu mong muốn:

**Kiểu A — 1 tầng (đơn giản, tập trung mua hàng nhanh):**
- Nền màu đậm (primary), sticky khi cuộn.
- Trái: icon menu hamburger + logo.
- Giữa: thanh tìm kiếm pill bo tròn hoàn toàn, nền trắng.
- Phải: dòng nhấn mạnh tốc độ giao hàng (icon tia sét + số phút nổi bật màu vàng), icon giỏ hàng có badge số lượng, avatar tài khoản.

**Kiểu B — 2 tầng (đầy đủ menu, phù hợp site có nhiều trang nội dung):**
- Tầng trên (thanh tiện ích, nền nhạt): dropdown "Tất cả danh mục", ô tìm kiếm dài, icon giỏ hàng, nút "Đăng nhập" bo góc.
- Tầng dưới (nền trắng): logo + tên thương hiệu bên trái, menu ngang (Trang chủ/Giới thiệu/Sản phẩm/Blog/Tuyển dụng/Liên hệ), icon mạng xã hội bên phải.

## 5. Hero Banner (trang chủ)

Có thể dùng 1 trong 2 bố cục, hoặc kết hợp theo mùa/chiến dịch:

- **Bố cục full-width đơn (Gromuse)**: khối bo góc lớn, nền màu đậm, hoạ tiết line-art mờ trang trí, tiêu đề 2 dòng lớn bên trái + mô tả + nút CTA bo tròn, ảnh sản phẩm thật bên phải, cạnh dưới bo cong lượn sóng nối xuống nội dung kế tiếp.
- **Bố cục đa banner (Grocery Bazar)**: lưới 2 cột — cột trái là 1 banner lớn (nền pastel nhạt, tag pill nhỏ phía trên tiêu đề như "Organic Food", tiêu đề + nút "Show Now" + ảnh sản phẩm), cột phải là 2 banner nhỏ xếp chồng (mỗi banner 1 màu nền khác nhau, có nhãn ưu đãi "Only This Week"/"-12% Off" + link "Shop Now" + ảnh).

## 6. Danh mục nhanh (Category Shortcuts / Shop By Category)

- Tiêu đề section căn giữa (nếu dùng kiểu Grocery Bazar) hoặc bỏ qua tiêu đề, hiển thị ngay dưới hero (kiểu Gromuse).
- Mỗi thẻ danh mục: ảnh sản phẩm đại diện, tên danh mục, số lượng item ("Item (20)").
- Hai lựa chọn nền thẻ:
  - Nền trắng đồng nhất, icon nhỏ minh hoạ (Gromuse) — tối giản.
  - Nền pastel riêng từng thẻ theo màu đặc trưng của danh mục (Grocery Bazar) — sinh động, dễ phân biệt bằng mắt.
- Nếu số danh mục nhiều hơn 4–5, thêm **carousel dot** bên dưới để chuyển trang ngang (vuốt/next).
- Thẻ cuối cùng có thể là nút "Xem tất cả" nổi bật thay vì 1 danh mục cụ thể.

## 7. Dải banner khuyến mãi (Promo Strip)

- 3–4 banner nhỏ nằm ngang, mỗi banner 1 màu nền/pastel khác nhau.
- Nội dung: nhãn nhỏ "Only This Week"/"Chỉ tuần này", tiêu đề chương trình 2 dòng, link "Shop Now" gạch chân, ảnh sản phẩm cắt nền đặt lệch phải.

## 8. Section sản phẩm (Best Selling / Gợi ý sản phẩm)

- Tiêu đề lớn — có thể căn trái kèm link "See more" bên phải (Gromuse) hoặc căn giữa kèm nút "View All Products" ở cuối grid (Grocery Bazar).
- **Tuỳ chọn thêm tab lọc danh mục** dạng pill ngang phía trên grid (Đông lạnh, Rau củ, Snack...) nếu muốn tăng khả năng khám phá sản phẩm ngay tại trang chủ.
- Grid sản phẩm 3–5 cột (desktop), mỗi product card gồm:
  - Ảnh sản phẩm nền trắng, tỉ lệ vuông.
  - Tên sản phẩm (có thể kèm tag phụ như "Chợ địa phương").
  - Đánh giá sao (tuỳ chọn, hiển thị số sao vàng).
  - Giá tiền nổi bật, đậm.
  - Nút hành động — 2 kiểu:
    - **Nút "khay" bo cong ở đáy card**, khi bấm chuyển thành thanh `− [số lượng] +` màu accent để tăng/giảm ngay tại chỗ (không rời trang) — ưu tiên dùng cho trải nghiệm mượt.
    - **Nút viền outline tĩnh "Add To Cart"** — đơn giản, phù hợp site cần tối giản thao tác nhấn.
- Card có bóng đổ rất nhẹ, hover nhấc nhẹ lên (translateY nhỏ).

## 9. Banner tải App (tuỳ chọn, nếu có app di động)

- Nền đỏ đô rất đậm (gần đen, xem "Primary – tối hơn" ở mục 2), bo góc lớn, hoạ tiết line-art trang trí.
- Trái: tiêu đề 3 dòng lớn, mô tả ngắn, 2 badge "Google Play"/"App Store".
- Phải: ảnh nhân viên giao hàng cầm giỏ thực phẩm, cắt nền, đặt lệch tạo động.

## 10. Section "Vì sao chọn chúng tôi" / Cách thức hoạt động (tuỳ chọn)

- Nền màu accent full-width, bo cong ở mép trên nối với section trước.
- Tiêu đề + mô tả căn giữa.
- Dải thẻ dọc (carousel ngang) nền đậm, mỗi thẻ: tiêu đề bước + minh hoạ line-art đơn sắc (VD: "Quét mã thanh toán", "Nhận quà tặng", "Đặt và nhận hàng").

## 11. Testimonial khách hàng *(mới bổ sung từ Grocery Bazar)*

- Nền trắng, tiêu đề section căn giữa ("Hear From Our Clients"/"Khách hàng nói gì").
- Bố cục 2 cột: trái là ảnh chân dung khách hàng (khung vuông/bo góc), phải là khối trích dẫn (nền pastel nhạt) chứa đoạn cảm nhận, tên khách hàng + địa điểm bên dưới.
- Nút điều hướng trái/phải (mũi tên tròn, nút hiện tại màu accent nổi bật, nút còn lại màu xám nhạt) để chuyển sang đánh giá khác — dạng carousel đơn giản.

## 12. Trang danh mục / Kết quả lọc (Category Listing Page)

- Breadcrumb đơn giản: `Tên shop / Tên danh mục`.
- Thanh filter ngang: dropdown Danh mục, Giá, Đánh giá, Màu sắc, Chất liệu, Ưu đãi, "Tất cả bộ lọc" (icon), và "Sắp xếp theo" bên phải.
- Grid sản phẩm dùng chung component card như trang chủ để đảm bảo nhất quán toàn hệ thống.

## 13. Trang chi tiết sản phẩm (Product Detail Page)

- Bố cục 2 cột: trái là ảnh sản phẩm lớn (badge giảm giá tròn góc) + dải thumbnail bên dưới; phải là thông tin sản phẩm.
- Cột phải: đồng hồ đếm ngược flash sale (tuỳ chọn), tên shop, tên sản phẩm, đánh giá sao + số lượt review, giá lớn, 2 nút CTA (outline "Thêm vào giỏ" + fill nổi bật "Mua ngay"), link phụ ("Yêu thích", "So sánh"), badge tin cậy (số lượng đã bán gần đây), SKU, danh mục liên quan dạng link, mô tả ngắn.

## 14. Footer *(mới bổ sung từ Grocery Bazar)*

- Nền đỏ đô gần đen (`#250608`), chữ kem nhạt và xám ấm, chia thành các cột rõ ràng:
  - Cột 1: logo + tên thương hiệu + icon mạng xã hội (Facebook, Instagram, YouTube...).
  - Cột 2 "Quick Links": Trang chủ, Giới thiệu, Sản phẩm, Blog, Tuyển dụng, Liên hệ.
  - Cột 3 "Information": Đổi trả, Hỗ trợ, Điều khoản, Chính sách bảo mật.
  - Cột 4 "Pay With": icon các phương thức thanh toán (Mastercard, Visa, ví điện tử...).
- Dòng cuối cùng: copyright căn giữa, cỡ chữ nhỏ.

## 15. Nguyên tắc trải nghiệm chung

- Mọi hành động thêm giỏ hàng nên có phản hồi tức thời tại chỗ (inline) khi có thể, tránh chuyển trang/mở modal gây gián đoạn.
- Nhất quán component: product card, nút CTA, badge giá dùng chung 1 kiểu trên toàn site (trang chủ, danh mục, tìm kiếm, chi tiết sản phẩm).
- Xen kẽ nền màu giữa các section để tạo nhịp điệu khi cuộn, tránh đơn điệu — nhưng không dùng quá 3–4 tông màu nền khác nhau trên cùng 1 trang.
- Ưu tiên hiển thị tốc độ giao hàng, khuyến mãi, đánh giá/số lượng đã bán, testimonial để tăng tính thúc đẩy mua hàng (urgency + social proof + trust).
- Responsive: card grid co giãn 5→3→2 cột theo màn hình; tab danh mục, filter, testimonial carousel chuyển thành vuốt ngang trên mobile; header 2 tầng có thể gộp còn 1 tầng trên mobile.

## 16. Gợi ý áp dụng cho thương hiệu Trà & Bánh

- Bảng màu và font ở mục 2–3 đã được chốt theo hướng đỏ đô + vàng gold, đồng bộ với khung ảnh sản phẩm đã dùng trước đó — áp dụng thẳng, không cần đổi thêm.
- Danh mục nhanh: Trà, Syrup, Trân châu, Bột, Sữa tươi, Sữa đặc, Mứt, Đồ lon, Kem đông lạnh, Công cụ dụng cụ — thay cho Fruits/Vegetable/Juice/Nuts & Seeds.
- Banner khuyến mãi/"Only This Week": có thể dùng cho combo nguyên liệu theo mùa (VD: "Set nguyên liệu trà sữa truyền chảo", "Giảm giá Syrup DaVinci tuần này").
- Section "Cách hoạt động": đổi nội dung thành quy trình đặt hàng sỉ/lẻ, giao hàng hoả tốc, tư vấn pha chế miễn phí — nhất quán thông điệp đã dùng trên khung ảnh sản phẩm (banner đã duyệt trước đó).
- Testimonial: dùng cảm nhận từ chủ quán trà sữa/quán cà phê đã mua nguyên liệu, kèm tên quán + khu vực để tăng độ tin cậy trong ngành B2B nguyên liệu pha chế.
- Footer: thêm mục liên hệ nhanh (Zalo/Hotline) ngoài mạng xã hội, vì khách hàng ngành F&B thường liên hệ đặt hàng qua Zalo nhiều hơn.
