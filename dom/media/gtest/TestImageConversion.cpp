/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "ImageContainer.h"
#include "ImageConversion.h"
#include "SourceSurfaceRawData.h"
#include "gtest/gtest.h"
#include "mozilla/CheckedInt.h"
#include "mozilla/RefPtr.h"
#include "mozilla/dom/ImageBitmapBinding.h"
#include "mozilla/dom/ImageUtils.h"

using mozilla::CheckedInt;
using mozilla::ConvertToI420;
using mozilla::ConvertToNV12;
using mozilla::MakeAndAddRef;
using mozilla::MakeRefPtr;
using mozilla::Maybe;
using mozilla::Nothing;
using mozilla::Some;
using mozilla::dom::ImageBitmapFormat;
using mozilla::gfx::ChromaSize;
using mozilla::gfx::ChromaSubsampling;
using mozilla::gfx::DataSourceSurface;
using mozilla::gfx::IntPoint;
using mozilla::gfx::IntRect;
using mozilla::gfx::IntSize;
using mozilla::gfx::SourceSurfaceAlignedRawData;
using mozilla::gfx::SurfaceFormat;
using mozilla::layers::PlanarYCbCrImage;
using mozilla::layers::SourceSurfaceImage;

class TestRedPlanarYCbCrImage2x2 final : public PlanarYCbCrImage {
 public:
  explicit TestRedPlanarYCbCrImage2x2(ImageBitmapFormat aFormat) {
    mSize = IntSize(2, 2);
    mBufferSize = sizeof(mY) + sizeof(mU) + sizeof(mV);
    mData.mPictureRect = mozilla::gfx::IntRect(mozilla::gfx::IntPoint(), mSize);
    mData.mYChannel = mY;
    mData.mYStride = 2;
    switch (aFormat) {
      case ImageBitmapFormat::YUV420P:
        mData.mChromaSubsampling = ChromaSubsampling::HALF_WIDTH_AND_HEIGHT;
        mData.mCbChannel = mU;
        mData.mCrChannel = mV;
        mData.mCbCrStride = 1;
        break;
      case ImageBitmapFormat::YUV422P:
        mData.mChromaSubsampling = ChromaSubsampling::HALF_WIDTH;
        mData.mCbChannel = mU;
        mData.mCrChannel = mV;
        mData.mCbCrStride = 1;
        break;
      case ImageBitmapFormat::YUV444P:
        mData.mChromaSubsampling = ChromaSubsampling::FULL;
        mData.mCbChannel = mU;
        mData.mCrChannel = mV;
        mData.mCbCrStride = 2;
        break;
      case ImageBitmapFormat::YUV420SP_NV12:
        mData.mChromaSubsampling = ChromaSubsampling::HALF_WIDTH_AND_HEIGHT;
        mData.mCbChannel = mU;
        mData.mCrChannel = mData.mCbChannel + 1;
        mData.mCbCrStride = 1;
        mData.mCrSkip = 1;
        mData.mCbSkip = 1;
        mU[1] = mV[0];
        mU[3] = mV[1];
        break;
      case ImageBitmapFormat::YUV420SP_NV21:
        mData.mChromaSubsampling = ChromaSubsampling::HALF_WIDTH_AND_HEIGHT;
        mData.mCrChannel = mU;
        mData.mCbChannel = mData.mCrChannel + 1;
        mData.mCbCrStride = 1;
        mData.mCrSkip = 1;
        mData.mCbSkip = 1;
        mU[0] = mV[0];
        mU[2] = mV[1];
        break;
      default:
        MOZ_CRASH("Unsupported ImageBitmapFormat!");
        break;
    }
  }

  nsresult CopyData(const Data& aData) override {
    return NS_ERROR_NOT_IMPLEMENTED;
  }

  size_t SizeOfExcludingThis(mozilla::MallocSizeOf aMallocSizeOf) const {
    return 0;
  }

 private:
  uint8_t mY[4] = {0x52, 0x52, 0x52, 0x52};
  uint8_t mU[4] = {0x5A, 0x5A, 0x5A, 0x5A};
  uint8_t mV[4] = {0xEF, 0xEF, 0xEF, 0xEF};
};

static already_AddRefed<SourceSurfaceImage> CreateRedSurfaceImage2x2(
    SurfaceFormat aFormat) {
  uint8_t redPixel[4] = {};

  switch (aFormat) {
    case SurfaceFormat::R8G8B8A8:
    case SurfaceFormat::R8G8B8X8:
      redPixel[0] = 0xFF;
      redPixel[3] = 0xFF;
      break;
    case SurfaceFormat::B8G8R8A8:
    case SurfaceFormat::B8G8R8X8:
      redPixel[2] = 0xFF;
      redPixel[3] = 0xFF;
      break;
    case SurfaceFormat::R5G6B5_UINT16:
      redPixel[1] = 0xF8;
      break;
    default:
      MOZ_ASSERT_UNREACHABLE("Unsupported format!");
      return nullptr;
  }

  const IntSize size(2, 2);

  auto surface = MakeRefPtr<SourceSurfaceAlignedRawData>();
  if (NS_WARN_IF(!surface->Init(size, aFormat, /* aClearMem */ false, 0, 0))) {
    return nullptr;
  }

  DataSourceSurface::ScopedMap map(surface, DataSourceSurface::WRITE);
  if (NS_WARN_IF(!map.IsMapped())) {
    return nullptr;
  }

  const uint32_t bpp = BytesPerPixel(aFormat);
  MOZ_ASSERT(bpp <= sizeof(redPixel));

  uint8_t* rowPtr = map.GetData();
  for (int32_t row = 0; row < size.height; ++row) {
    for (int32_t col = 0; col < size.width; ++col) {
      for (uint32_t i = 0; i < bpp; ++i) {
        rowPtr[col * bpp + i] = redPixel[i];
      }
    }
    rowPtr += map.GetStride();
  }

  return MakeAndAddRef<SourceSurfaceImage>(size, surface);
}

TEST(MediaImageConversion, ConvertToI420)
{
  uint8_t y[20] = {};
  uint8_t u[20] = {};
  uint8_t v[20] = {};

  auto checkBuf = [&](const uint8_t* aY, const uint8_t* aU, const uint8_t* aV) {
    for (size_t i = 0; i < sizeof(y); ++i) {
      EXPECT_EQ(y[i], aY[i]);
    }
    for (size_t i = 0; i < sizeof(u); ++i) {
      EXPECT_EQ(u[i], aU[i]);
    }
    for (size_t i = 0; i < sizeof(v); ++i) {
      EXPECT_EQ(v[i], aV[i]);
    }
    memset(y, 0, sizeof(y));
    memset(u, 0, sizeof(u));
    memset(v, 0, sizeof(v));
  };

  static constexpr uint8_t yRed1x1[20] = {0x52};
  static constexpr uint8_t yRed2x2[20] = {0x52, 0x52, 0x52, 0x52};
  static constexpr uint8_t yRed4x4[20] = {0x52, 0x52, 0x52, 0x52, 0x52, 0x52,
                                          0x52, 0x52, 0x52, 0x52, 0x52, 0x52,
                                          0x52, 0x52, 0x52, 0x52};

  static constexpr uint8_t uRed1x1[20] = {0x5A};
  static constexpr uint8_t uRed2x2[20] = {0x5A, 0x5A, 0x5A, 0x5A};

  static constexpr uint8_t vRed1x1[20] = {0xEF};
  static constexpr uint8_t vRed2x2[20] = {0xEF, 0xEF, 0xEF, 0xEF};

  auto checkImage = [&](mozilla::layers::Image* aImage,
                        const Maybe<ImageBitmapFormat>& aFormat) {
    ASSERT_TRUE(!!aImage);

    mozilla::dom::ImageUtils utils(aImage);
    Maybe<ImageBitmapFormat> format = utils.GetFormat();
    ASSERT_EQ(format.isSome(), aFormat.isSome());
    if (format.isSome()) {
      ASSERT_EQ(format.value(), aFormat.value());
    }

    EXPECT_TRUE(
        NS_SUCCEEDED(ConvertToI420(aImage, y, 2, u, 1, v, 1, IntSize(2, 2))));
    checkBuf(yRed2x2, uRed1x1, vRed1x1);

    EXPECT_TRUE(
        NS_SUCCEEDED(ConvertToI420(aImage, y, 1, u, 1, v, 1, IntSize(1, 1))));
    checkBuf(yRed1x1, uRed1x1, vRed1x1);

    EXPECT_TRUE(
        NS_SUCCEEDED(ConvertToI420(aImage, y, 4, u, 2, v, 2, IntSize(4, 4))));
    checkBuf(yRed4x4, uRed2x2, vRed2x2);
  };

  RefPtr<SourceSurfaceImage> imgRgba =
      CreateRedSurfaceImage2x2(SurfaceFormat::R8G8B8A8);
  checkImage(imgRgba, Some(ImageBitmapFormat::RGBA32));

  RefPtr<SourceSurfaceImage> imgBgra =
      CreateRedSurfaceImage2x2(SurfaceFormat::B8G8R8A8);
  checkImage(imgBgra, Some(ImageBitmapFormat::BGRA32));

  RefPtr<SourceSurfaceImage> imgRgb565 =
      CreateRedSurfaceImage2x2(SurfaceFormat::R5G6B5_UINT16);
  checkImage(imgRgb565, Nothing());

  auto imgYuv420p =
      MakeRefPtr<TestRedPlanarYCbCrImage2x2>(ImageBitmapFormat::YUV420P);
  checkImage(imgYuv420p, Some(ImageBitmapFormat::YUV420P));

  auto imgYuv422p =
      MakeRefPtr<TestRedPlanarYCbCrImage2x2>(ImageBitmapFormat::YUV422P);
  checkImage(imgYuv422p, Some(ImageBitmapFormat::YUV422P));

  auto imgYuv444p =
      MakeRefPtr<TestRedPlanarYCbCrImage2x2>(ImageBitmapFormat::YUV444P);
  checkImage(imgYuv444p, Some(ImageBitmapFormat::YUV444P));

  auto imgYuvNv12 =
      MakeRefPtr<TestRedPlanarYCbCrImage2x2>(ImageBitmapFormat::YUV420SP_NV12);
  checkImage(imgYuvNv12, Some(ImageBitmapFormat::YUV420SP_NV12));

  auto imgYuvNv21 =
      MakeRefPtr<TestRedPlanarYCbCrImage2x2>(ImageBitmapFormat::YUV420SP_NV21);
  checkImage(imgYuvNv21, Some(ImageBitmapFormat::YUV420SP_NV21));
}

// PlanarYCbCrData::mPictureRect, not the region anchored at the coded-buffer
// origin (0,0). The sibling YUV->RGB path (ConvertYCbCrToRGB) honors
// mPictureRect.TopLeft(); these tests guard that the I420/NV12 paths do the
// same. Each test builds an I420 source whose coded buffer is larger than the
// picture, fills the whole buffer with a "border" value and the picture
// sub-region with a distinct "content" value, then asserts the converted
// output carries the content value.
namespace {

// A Y/Cb/Cr sample triple used to paint and verify a planar image.
struct YCbCrValue {
  uint8_t mY;
  uint8_t mCb;
  uint8_t mCr;
};

// I420 PlanarYCbCrImage whose coded planes are larger than the picture rect.
// The whole buffer is painted aBorder; the picture sub-region (offset by
// mPictureRect.TopLeft()) is painted aContent. All extents must be even, as
// required for 4:2:0 chroma alignment.
class OffsetPictureRectI420Image final : public PlanarYCbCrImage {
 public:
  OffsetPictureRectI420Image(const IntSize& aCodedSize,
                             const IntRect& aPictureRect,
                             const YCbCrValue& aBorder,
                             const YCbCrValue& aContent) {
    MOZ_ASSERT(!aCodedSize.IsEmpty(), "coded size must not be empty");
    MOZ_ASSERT(!aPictureRect.IsEmpty(), "picture rect must not be empty");
    MOZ_ASSERT(aPictureRect.x % 2 == 0 && aPictureRect.y % 2 == 0 &&
                   aPictureRect.width % 2 == 0 && aPictureRect.height % 2 == 0,
               "picture rect must be even for 4:2:0 chroma alignment");
    MOZ_ASSERT(IntRect(IntPoint(), aCodedSize).Contains(aPictureRect),
               "picture rect must fit inside the coded buffer");

    // ChromaSize rounds up, so an odd coded buffer is representable; only the
    // picture rect has to be even, for chroma alignment.
    const IntSize codedChroma =
        ChromaSize(aCodedSize, ChromaSubsampling::HALF_WIDTH_AND_HEIGHT);
    const CheckedInt<size_t> ySize =
        CheckedInt<size_t>(aCodedSize.width) * aCodedSize.height;
    const CheckedInt<size_t> cSize =
        CheckedInt<size_t>(codedChroma.width) * codedChroma.height;
    MOZ_ASSERT((ySize + cSize * 2).isValid(), "plane sizes are not valid");

    mY.SetLength(ySize.value());
    mU.SetLength(cSize.value());
    mV.SetLength(cSize.value());
    memset(mY.Elements(), aBorder.mY, ySize.value());
    memset(mU.Elements(), aBorder.mCb, cSize.value());
    memset(mV.Elements(), aBorder.mCr, cSize.value());

    FillRect(mY.Elements(), aCodedSize.width, aPictureRect.x, aPictureRect.y,
             aPictureRect.width, aPictureRect.height, aContent.mY);
    FillRect(mU.Elements(), codedChroma.width, aPictureRect.x / 2,
             aPictureRect.y / 2, aPictureRect.width / 2,
             aPictureRect.height / 2, aContent.mCb);
    FillRect(mV.Elements(), codedChroma.width, aPictureRect.x / 2,
             aPictureRect.y / 2, aPictureRect.width / 2,
             aPictureRect.height / 2, aContent.mCr);

    mSize = aPictureRect.Size();
    mBufferSize = ySize.value() + 2 * cSize.value();

    mData.mPictureRect = aPictureRect;
    mData.mYChannel = mY.Elements();
    mData.mYStride = aCodedSize.width;
    mData.mYSkip = 0;
    mData.mCbChannel = mU.Elements();
    mData.mCrChannel = mV.Elements();
    mData.mCbCrStride = codedChroma.width;
    mData.mCbSkip = 0;
    mData.mCrSkip = 0;
    mData.mChromaSubsampling = ChromaSubsampling::HALF_WIDTH_AND_HEIGHT;
  }

  nsresult CopyData(const Data& aData) override {
    return NS_ERROR_NOT_IMPLEMENTED;
  }
  size_t SizeOfExcludingThis(mozilla::MallocSizeOf) const { return 0; }

 private:
  static void FillRect(uint8_t* aPlane, int32_t aStride, int32_t aX, int32_t aY,
                       int32_t aW, int32_t aH, uint8_t aValue) {
    for (int32_t row = aY; row < aY + aH; ++row) {
      memset(aPlane + size_t(row) * aStride + aX, aValue, aW);
    }
  }

 private:
  nsTArray<uint8_t> mY;
  nsTArray<uint8_t> mU;
  nsTArray<uint8_t> mV;
};

}  // namespace

TEST(MediaImageConversion, ConvertToI420HonorsPictureRectOrigin)
{
  // Odd coded extents on purpose: the picture rect has to be even for chroma
  // alignment, but the buffer around it does not.
  const IntSize coded(65, 63);
  const IntRect picture(16, 8, 32, 32);
  const YCbCrValue border{0x10, 0x20, 0x30};
  const YCbCrValue content{0x80, 0xA0, 0xC0};
  auto image =
      MakeRefPtr<OffsetPictureRectI420Image>(coded, picture, border, content);

  const int32_t chromaW = picture.width / 2;
  const int32_t chromaH = picture.height / 2;
  nsTArray<uint8_t> destY;
  nsTArray<uint8_t> destU;
  nsTArray<uint8_t> destV;
  destY.SetLength(size_t(picture.width) * picture.height);
  destU.SetLength(size_t(chromaW) * chromaH);
  destV.SetLength(size_t(chromaW) * chromaH);

  ASSERT_TRUE(NS_SUCCEEDED(
      ConvertToI420(image, destY.Elements(), picture.width, destU.Elements(),
                    chromaW, destV.Elements(), chromaW, picture.Size())));

  for (const uint8_t& v : destY) {
    EXPECT_EQ(v, content.mY);
  }
  for (const uint8_t& v : destU) {
    EXPECT_EQ(v, content.mCb);
  }
  for (const uint8_t& v : destV) {
    EXPECT_EQ(v, content.mCr);
  }
}

TEST(MediaImageConversion, ConvertToNV12HonorsPictureRectOrigin)
{
  // Odd coded extents on purpose: the picture rect has to be even for chroma
  // alignment, but the buffer around it does not.
  const IntSize coded(65, 63);
  const IntRect picture(16, 8, 32, 32);
  const YCbCrValue border{0x10, 0x20, 0x30};
  const YCbCrValue content{0x80, 0xA0, 0xC0};
  auto image =
      MakeRefPtr<OffsetPictureRectI420Image>(coded, picture, border, content);

  nsTArray<uint8_t> destY;
  nsTArray<uint8_t> destUV;
  destY.SetLength(size_t(picture.width) * picture.height);
  destUV.SetLength(size_t(picture.width) * (picture.height / 2));

  ASSERT_TRUE(NS_SUCCEEDED(ConvertToNV12(image, destY.Elements(), picture.width,
                                         destUV.Elements(), picture.width,
                                         picture.Size())));

  for (const uint8_t& v : destY) {
    EXPECT_EQ(v, content.mY);
  }
  // NV12 interleaves U/V: even bytes are U, odd bytes are V.
  for (size_t i = 0; i < destUV.Length(); ++i) {
    EXPECT_EQ(destUV[i], (i % 2 == 0) ? content.mCb : content.mCr);
  }
}
