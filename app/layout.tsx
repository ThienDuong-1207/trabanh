export const metadata = {
  title: "Quản lý giá - Tiệm Trà Bánh",
  description: "Quản lý giá sản phẩm và xuất file MISA / bảng giá 7.7x4cm",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "Arial, sans-serif", margin: 0, background: "#f5f6f8" }}>
        {children}
      </body>
    </html>
  );
}
